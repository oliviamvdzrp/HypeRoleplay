const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 10000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "Hype Roleplay",
    time: new Date().toISOString()
  });
});

// Compatível com Express 5
app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const rooms = new Map();

function send(ws, message) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(room, message, except = null) {
  for (const client of room.clients) {
    if (client !== except) {
      send(client.ws, message);
    }
  }
}

function getRoom(id) {
  let room = rooms.get(id);

  if (!room) {
    room = {
      clients: new Set(),
      password: null,
      host: null,
      mutedAll: false,
      allowSharing: true,
      allowMic: true
    };

    rooms.set(id, room);
  }

  return room;
}

function cleanRoom(room) {
  if (room.clients.size === 0) {
    for (const [id, currentRoom] of rooms) {
      if (currentRoom === room) {
        rooms.delete(id);
      }
    }
  }
}

function isHost(room, peerId) {
  return room.host === peerId;
}

function participantInfo(p) {
  return {
    peerId: p.peerId,
    name: p.name,
    sharing: p.sharing,
    muted: p.muted
  };
}

wss.on("connection", (ws) => {
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (raw) => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // =========================
    // ENTRAR NA SALA
    // =========================
    if (msg.type === "join") {
      const id = String(msg.room || "")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 32);

      const name =
        String(msg.name || "Convidado")
          .trim()
          .slice(0, 30) || "Convidado";

      const password = String(msg.password || "");

      if (!id) {
        return send(ws, {
          type: "error",
          message: "Sala inválida."
        });
      }

      const room = getRoom(id);

      if (room.password && room.password !== password) {
        return send(ws, {
          type: "password-required",
          message: "Essa sala possui uma senha."
        });
      }

      if (room.clients.size >= 12) {
        return send(ws, {
          type: "error",
          message: "Esta sala atingiu o limite de 12 participantes."
        });
      }

      const peerId = crypto.randomUUID();

      ws.roomId = id;
      ws.peerId = peerId;
      ws.name = name;

      const participant = {
        ws,
        peerId,
        name,
        sharing: false,
        muted: false
      };

      // Primeiro participante = ADM
      if (!room.host) {
        room.host = peerId;
      }

      room.clients.add(participant);

      send(ws, {
        type: "joined",
        peerId,
        room: id,
        host: room.host,
        mutedAll: room.mutedAll,
        allowSharing: room.allowSharing,
        allowMic: room.allowMic,

        participants: [...room.clients].map(participantInfo)
      });

      broadcast(
        room,
        {
          type: "participant-joined",
          participant: participantInfo(participant)
        },
        participant
      );

      return;
    }

    // =========================
    // VERIFICAR SALA
    // =========================
    const room = ws.roomId
      ? rooms.get(ws.roomId)
      : null;

    if (!room) return;

    const me = [...room.clients].find(
      (p) => p.ws === ws
    );

    if (!me) return;

    // =========================
    // WEBRTC
    // =========================
    if (msg.type === "signal") {
      const target = [...room.clients].find(
        (p) => p.peerId === msg.to
      );

      if (target) {
        send(target.ws, {
          type: "signal",
          from: me.peerId,
          fromName: me.name,
          signal: msg.signal
        });
      }

      return;
    }

    // =========================
    // COMPARTILHAMENTO
    // =========================
    if (msg.type === "sharing") {

      if (!room.allowSharing && !isHost(room, me.peerId)) {
        return send(ws, {
          type: "sharing-blocked",
          message: "O administrador bloqueou o compartilhamento de tela."
        });
      }

      me.sharing = !!msg.value;

      broadcast(room, {
        type: "participant-updated",
        participant: participantInfo(me)
      });

      return;
    }

    // =========================
    // CHAT
    // =========================
    if (msg.type === "chat") {
      const text = String(msg.text || "")
        .trim()
        .slice(0, 500);

      if (!text) return;

      broadcast(room, {
        type: "chat",
        from: me.name,
        peerId: me.peerId,
        text,
        at: Date.now()
      });

      return;
    }

    // =========================
    // MUTE TODOS
    // =========================
    if (msg.type === "mute-all") {

      if (!isHost(room, me.peerId)) {
        return send(ws, {
          type: "error",
          message: "Somente o administrador pode fazer isso."
        });
      }

      room.mutedAll = !!msg.value;

      for (const participant of room.clients) {
        if (participant.peerId !== me.peerId) {
          participant.muted = room.mutedAll;
        }
      }

      broadcast(room, {
        type: "mute-all",
        value: room.mutedAll
      });

      return;
    }

    // =========================
    // MUTE INDIVIDUAL
    // =========================
    if (msg.type === "mute-user") {

      if (!isHost(room, me.peerId)) {
        return send(ws, {
          type: "error",
          message: "Somente o administrador pode mutar participantes."
        });
      }

      const target = [...room.clients].find(
        (p) => p.peerId === msg.peerId
      );

      if (!target) return;

      target.muted = !!msg.value;

      send(target.ws, {
        type: "force-mute",
        value: target.muted
      });

      broadcast(room, {
        type: "participant-updated",
        participant: participantInfo(target)
      });

      return;
    }

    // =========================
    // PERMITIR/BLOQUEAR MICROFONE
    // =========================
    if (msg.type === "mic-permission") {

      if (!isHost(room, me.peerId)) {
        return send(ws, {
          type: "error",
          message: "Somente o administrador pode alterar essa configuração."
        });
      }

      room.allowMic = !!msg.value;

      broadcast(room, {
        type: "mic-permission",
        value: room.allowMic
      });

      return;
    }

    // =========================
    // PERMITIR/BLOQUEAR TRANSMISSÃO
    // =========================
    if (msg.type === "sharing-permission") {

      if (!isHost(room, me.peerId)) {
        return send(ws, {
          type: "error",
          message: "Somente o administrador pode alterar essa configuração."
        });
      }

      room.allowSharing = !!msg.value;

      if (!room.allowSharing) {
        for (const participant of room.clients) {
          if (participant.peerId !== me.peerId) {
            participant.sharing = false;
          }
        }
      }

      broadcast(room, {
        type: "sharing-permission",
        value: room.allowSharing
      });

      return;
    }

    // =========================
    // EXPULSAR USUÁRIO
    // =========================
    if (msg.type === "kick-user") {

      // Apenas o ADM pode expulsar
      if (!isHost(room, me.peerId)) {
        return send(ws, {
          type: "error",
          message: "Somente o administrador pode expulsar usuários."
        });
      }

      const target = [...room.clients].find(
        (p) => p.peerId === msg.peerId
      );

      if (!target) {
        return send(ws, {
          type: "error",
          message: "Usuário não encontrado."
        });
      }

      // Não pode expulsar a si mesmo
      if (target.peerId === me.peerId) {
        return send(ws, {
          type: "error",
          message: "Você não pode expulsar a si mesmo."
        });
      }

      // Avisa o usuário antes de desconectar
      send(target.ws, {
        type: "kicked",
        message: "Você foi removido da sala pelo administrador."
      });

      // Avisa os outros participantes
      broadcast(room, {
        type: "participant-kicked",
        peerId: target.peerId,
        name: target.name
      }, target);

      // Remove da sala
      room.clients.delete(target);

      try {
        target.ws.close(4001, "Kicked by host");
      } catch {}

      return;
    }

    // =========================
    // ALTERAR SENHA
    // =========================
    if (msg.type === "set-password") {

      if (!isHost(room, me.peerId)) {
        return send(ws, {
          type: "error",
          message: "Somente o administrador pode alterar a senha."
        });
      }

      const password = String(msg.password || "").trim();

      room.password = password || null;

      send(ws, {
        type: "password-updated",
        hasPassword: !!room.password
      });

      return;
    }
  });

  // =========================
  // USUÁRIO SAIU
  // =========================
  ws.on("close", () => {

    const room = ws.roomId
      ? rooms.get(ws.roomId)
      : null;

    if (!room) return;

    const me = [...room.clients].find(
      (p) => p.ws === ws
    );

    if (me) {

      room.clients.delete(me);

      broadcast(room, {
        type: "participant-left",
        peerId: me.peerId
      });

      // Se o ADM saiu, passa para outro
      if (room.host === me.peerId) {

        const next = room.clients.values().next().value;

        room.host = next
          ? next.peerId
          : null;

        if (next) {
          broadcast(room, {
            type: "host-changed",
            peerId: room.host
          });
        }
      }
    }

    cleanRoom(room);
  });
});

// =========================
// KEEP ALIVE
// =========================
setInterval(() => {

  for (const ws of wss.clients) {

    if (!ws.isAlive) {
      try {
        ws.terminate();
      } catch {}

      continue;
    }

    ws.isAlive = false;

    try {
      ws.ping();
    } catch {}
  }

}, 30000);

// =========================
// SERVIDOR
// =========================
server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Hype Roleplay rodando na porta ${PORT}`
  );
});
