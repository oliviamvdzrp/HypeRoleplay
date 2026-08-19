const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 10000;
const MAX_PARTICIPANTS = 12;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "Hype Roleplay",
    time: new Date().toISOString()
  });
});

/*
 * Express 5 não aceita mais app.get("*").
 * Esta forma evita o erro path-to-regexp.
 */
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/health")) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  } else {
    next();
  }
});

const rooms = new Map();

function createRoomId() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function createPassword() {
  return crypto.randomBytes(12).toString("hex");
}

function send(ws, data) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data, except = null) {
  for (const participant of room.clients) {
    if (participant !== except) {
      send(participant.ws, data);
    }
  }
}

function getRoom(id) {
  let room = rooms.get(id);

  if (!room) {
    room = {
      id,
      password: null,
      clients: new Set(),
      adminId: null,
      mutedAll: false
    };

    rooms.set(id, room);
  }

  return room;
}

function getParticipant(room, peerId) {
  return [...room.clients].find(
    participant => participant.peerId === peerId
  );
}

function publicParticipant(participant) {
  return {
    peerId: participant.peerId,
    name: participant.name,
    sharing: participant.sharing,
    muted: participant.muted,
    isAdmin: participant.isAdmin
  };
}

function cleanRoom(room) {
  if (!room || room.clients.size === 0) {
    rooms.delete(room.id);
  }
}

/* =========================
   WEBSOCKET
========================= */

wss.on("connection", ws => {
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", raw => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    /* =========================
       ENTRAR NA SALA
    ========================= */

    if (msg.type === "join") {
      const id = String(msg.room || "")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 32);

      const name =
        String(msg.name || "Convidado")
          .trim()
          .slice(0, 30) || "Convidado";

      if (!id) {
        return send(ws, {
          type: "error",
          message: "Sala inválida."
        });
      }

      const room = getRoom(id);

      if (room.clients.size >= MAX_PARTICIPANTS) {
        return send(ws, {
          type: "error",
          message: `A sala atingiu o limite de ${MAX_PARTICIPANTS} participantes.`
        });
      }

      /*
       * A senha é conferida somente quando a sala já possui senha.
       */
      if (room.password) {
        const password = String(msg.password || "");

        if (password !== room.password) {
          return send(ws, {
            type: "password-required",
            message: "Esta sala possui uma senha."
          });
        }
      }

      const peerId = crypto.randomUUID();

      const isAdmin = room.clients.size === 0;

      const participant = {
        ws,
        peerId,
        name,
        sharing: false,
        muted: false,
        isAdmin
      };

      ws.roomId = id;
      ws.peerId = peerId;
      ws.name = name;

      room.clients.add(participant);

      if (isAdmin) {
        room.adminId = peerId;
      }

      send(ws, {
        type: "joined",
        peerId,
        room: id,
        isAdmin,
        mutedAll: room.mutedAll,
        participants: [...room.clients].map(publicParticipant)
      });

      broadcast(
        room,
        {
          type: "participant-joined",
          participant: publicParticipant(participant)
        },
        participant
      );

      return;
    }

    /* =========================
       PEGAR SALA
    ========================= */

    const room = ws.roomId
      ? rooms.get(ws.roomId)
      : null;

    if (!room) {
      return;
    }

    const me = getParticipant(room, ws.peerId);

    if (!me) {
      return;
    }

    /* =========================
       WEBRTC SIGNAL
    ========================= */

    if (msg.type === "signal") {
      const target = getParticipant(room, msg.to);

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

    /* =========================
       COMPARTILHAMENTO
    ========================= */

    if (msg.type === "sharing") {
      me.sharing = !!msg.value;

      broadcast(room, {
        type: "participant-updated",
        participant: publicParticipant(me)
      });

      return;
    }

    /* =========================
       CHAT
    ========================= */

    if (msg.type === "chat") {
      const text = String(msg.text || "")
        .trim()
        .slice(0, 500);

      if (!text) {
        return;
      }

      broadcast(room, {
        type: "chat",
        from: me.name,
        peerId: me.peerId,
        text,
        at: Date.now()
      });

      return;
    }

    /* =========================
       ADM: CRIAR / DEFINIR SENHA
    ========================= */

    if (msg.type === "set-password") {
      if (room.adminId !== me.peerId) {
        return send(ws, {
          type: "error",
          message: "Somente o administrador pode alterar a senha."
        });
      }

      const password = String(msg.password || "")
        .trim()
        .slice(0, 50);

      room.password = password || null;

      send(ws, {
        type: "password-updated",
        enabled: !!room.password
      });

      return;
    }

    /* =========================
       ADM: MUTAR UM USUÁRIO
    ========================= */

    if (msg.type === "mute-user") {
      if (room.adminId !== me.peerId) {
        return send(ws, {
          type: "error",
          message: "Somente o administrador pode mutar participantes."
        });
      }

      const target = getParticipant(room, msg.peerId);

      if (!target) {
        return;
      }

      target.muted = !!msg.muted;

      send(target.ws, {
        type: "force-mute",
        muted: target.muted,
        message: target.muted
          ? "O administrador desativou seu microfone."
          : "Seu microfone foi liberado."
      });

      broadcast(room, {
        type: "participant-updated",
        participant: publicParticipant(target)
      });

      return;
    }

    /* =========================
       ADM: MUTAR TODOS
    ========================= */

    if (msg.type === "mute-all") {
      if (room.adminId !== me.peerId) {
        return send(ws, {
          type: "error",
          message: "Somente o administrador pode mutar todos."
        });
      }

      room.mutedAll = !!msg.muted;

      for (const participant of room.clients) {
        if (participant.peerId === me.peerId) {
          continue;
        }

        participant.muted = room.mutedAll;

        send(participant.ws, {
          type: "force-mute",
          muted: room.mutedAll,
          message: room.mutedAll
            ? "O administrador mutou todos os microfones."
            : "O administrador liberou os microfones."
        });
      }

      broadcast(room, {
        type: "room-settings",
        mutedAll: room.mutedAll
      });

      return;
    }

    /* =========================
       ADM: EXPULSAR
    ========================= */

    if (msg.type === "kick") {
      if (room.adminId !== me.peerId) {
        return send(ws, {
          type: "error",
          message: "Somente o administrador pode expulsar usuários."
        });
      }

      const target = getParticipant(room, msg.peerId);

      if (!target) {
        return;
      }

      if (target.peerId === me.peerId) {
        return send(ws, {
          type: "error",
          message: "Você não pode expulsar a si mesmo."
        });
      }

      send(target.ws, {
        type: "kicked",
        message: "Você foi removido da sala pelo administrador."
      });

      setTimeout(() => {
        try {
          target.ws.close(4001, "Kicked");
        } catch {}
      }, 100);

      return;
    }

    /* =========================
       ADM: TRANSFERIR ADM
    ========================= */

    if (msg.type === "transfer-admin") {
      if (room.adminId !== me.peerId) {
        return send(ws, {
          type: "error",
          message: "Somente o administrador pode transferir a administração."
        });
      }

      const target = getParticipant(room, msg.peerId);

      if (!target) {
        return;
      }

      me.isAdmin = false;
      target.isAdmin = true;
      room.adminId = target.peerId;

      broadcast(room, {
        type: "participants-refresh",
        participants: [...room.clients].map(publicParticipant)
      });

      return;
    }
  });

  /* =========================
     DESCONEXÃO
  ========================= */

  ws.on("close", () => {
    const room = ws.roomId
      ? rooms.get(ws.roomId)
      : null;

    if (!room) {
      return;
    }

    const me = getParticipant(room, ws.peerId);

    if (!me) {
      return;
    }

    room.clients.delete(me);

    broadcast(room, {
      type: "participant-left",
      peerId: me.peerId
    });

    /*
     * Se o ADM sair, passa a administração para
     * o próximo participante.
     */
    if (room.adminId === me.peerId) {
      const nextAdmin = [...room.clients][0];

      if (nextAdmin) {
        room.adminId = nextAdmin.peerId;
        nextAdmin.isAdmin = true;

        send(nextAdmin.ws, {
          type: "became-admin",
          message: "Você agora é o administrador da sala."
        });

        broadcast(room, {
          type: "participants-refresh",
          participants: [...room.clients].map(publicParticipant)
        });
      }
    }

    cleanRoom(room);
  });
});

/* =========================
   HEARTBEAT
========================= */

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

/* =========================
   SERVIDOR
========================= */

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Hype Roleplay rodando na porta ${PORT}`
  );
});
