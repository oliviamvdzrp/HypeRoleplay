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

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const rooms = new Map();

function generateRoomId() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

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
      ownerId: null
    };

    rooms.set(id, room);
  }

  return room;
}

function findParticipant(room, peerId) {
  return [...room.clients].find(p => p.peerId === peerId);
}

function cleanRoom(room) {
  if (room.clients.size === 0) {
    for (const [id, r] of rooms.entries()) {
      if (r === room) {
        rooms.delete(id);
      }
    }
  }
}

function participantData(p) {
  return {
    peerId: p.peerId,
    name: p.name,
    sharing: p.sharing,
    micOn: p.micOn,
    isAdmin: p.peerId === p.roomOwnerId,
    device: p.device
  };
}

function sendParticipants(room) {
  const participants = [...room.clients].map(p => ({
    peerId: p.peerId,
    name: p.name,
    sharing: p.sharing,
    micOn: p.micOn,
    isAdmin: p.peerId === room.ownerId,
    device: p.device
  }));

  broadcast(room, {
    type: "participants",
    participants
  });
}

function getDevice(ws) {
  const ua = String(ws.userAgent || "").toLowerCase();

  if (
    ua.includes("iphone") ||
    ua.includes("ipad") ||
    ua.includes("android")
  ) {
    return "mobile";
  }

  return "desktop";
}

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

    /*
     * ENTRAR NA SALA
     */
    if (msg.type === "join") {
      const roomId = String(msg.room || "")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 32);

      const name =
        String(msg.name || "Convidado")
          .trim()
          .slice(0, 30) || "Convidado";

      if (!roomId) {
        return send(ws, {
          type: "error",
          message: "Sala inválida."
        });
      }

      const room = getRoom(roomId);

      if (room.clients.size >= 12) {
        return send(ws, {
          type: "error",
          message: "Esta sala atingiu o limite de 12 participantes."
        });
      }

      const peerId = crypto.randomUUID();

      ws.roomId = roomId;
      ws.peerId = peerId;
      ws.name = name;

      ws.userAgent = msg.userAgent || "";
      ws.device = getDevice(ws);

      /*
       * O PRIMEIRO DA SALA É O ADMINISTRADOR
       */
      if (!room.ownerId) {
        room.ownerId = peerId;
      }

      const participant = {
        ws,
        peerId,
        name,
        sharing: false,
        micOn: false,
        device: ws.device,
        roomOwnerId: room.ownerId
      };

      room.clients.add(participant);

      send(ws, {
        type: "joined",
        peerId,
        room: roomId,
        isAdmin: peerId === room.ownerId,
        canShare: ws.device === "desktop",
        participants: [...room.clients].map(p => ({
          peerId: p.peerId,
          name: p.name,
          sharing: p.sharing,
          micOn: p.micOn,
          isAdmin: p.peerId === room.ownerId,
          device: p.device
        }))
      });

      broadcast(
        room,
        {
          type: "participant-joined",
          participant: {
            peerId,
            name,
            sharing: false,
            micOn: false,
            isAdmin: peerId === room.ownerId,
            device: ws.device
          }
        },
        participant
      );

      sendParticipants(room);

      return;
    }

    const room = ws.roomId ? rooms.get(ws.roomId) : null;

    if (!room) {
      return;
    }

    const me = [...room.clients].find(p => p.ws === ws);

    if (!me) {
      return;
    }

    /*
     * WEBRTC SIGNALING
     */
    if (msg.type === "signal") {
      const target = findParticipant(room, msg.to);

      if (!target) {
        return;
      }

      send(target.ws, {
        type: "signal",
        from: me.peerId,
        fromName: me.name,
        signal: msg.signal
      });

      return;
    }

    /*
     * COMPARTILHAMENTO DE TELA
     */
    if (msg.type === "sharing") {
      /*
       * CELULAR NÃO PODE TRANSMITIR
       */
      if (me.device === "mobile" && msg.value === true) {
        return send(ws, {
          type: "error",
          message: "Celulares podem apenas assistir às transmissões."
        });
      }

      me.sharing = !!msg.value;

      broadcast(room, {
        type: "participant-updated",
        participant: {
          peerId: me.peerId,
          name: me.name,
          sharing: me.sharing,
          micOn: me.micOn,
          isAdmin: me.peerId === room.ownerId,
          device: me.device
        }
      });

      return;
    }

    /*
     * MICROFONE
     */
    if (msg.type === "mic") {
      me.micOn = !!msg.value;

      broadcast(room, {
        type: "participant-updated",
        participant: {
          peerId: me.peerId,
          name: me.name,
          sharing: me.sharing,
          micOn: me.micOn,
          isAdmin: me.peerId === room.ownerId,
          device: me.device
        }
      });

      return;
    }

    /*
     * ADMINISTRADOR ALTERA MICROFONE DE OUTRA PESSOA
     */
    if (msg.type === "admin-mic") {
      if (me.peerId !== room.ownerId) {
        return send(ws, {
          type: "error",
          message: "Somente o administrador pode controlar os microfones."
        });
      }

      const target = findParticipant(room, msg.peerId);

      if (!target) {
        return;
      }

      target.micOn = !!msg.value;

      send(target.ws, {
        type: "force-mic",
        value: target.micOn
      });

      broadcast(room, {
        type: "participant-updated",
        participant: {
          peerId: target.peerId,
          name: target.name,
          sharing: target.sharing,
          micOn: target.micOn,
          isAdmin: target.peerId === room.ownerId,
          device: target.device
        }
      });

      return;
    }

    /*
     * EXPULSAR USUÁRIO
     */
    if (msg.type === "kick") {
      if (me.peerId !== room.ownerId) {
        return send(ws, {
          type: "error",
          message: "Somente o administrador pode expulsar usuários."
        });
      }

      const target = findParticipant(room, msg.peerId);

      if (!target) {
        return;
      }

      if (target.peerId === room.ownerId) {
        return;
      }

      send(target.ws, {
        type: "kicked",
        message: "Você foi removido da sala pelo administrador."
      });

      send(target.ws, {
        type: "force-disconnect"
      });

      setTimeout(() => {
        try {
          target.ws.close();
        } catch {}
      }, 100);

      return;
    }

    /*
     * CHAT
     */
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
  });

  /*
   * DESCONECTOU
   */
  ws.on("close", () => {
    const room = ws.roomId ? rooms.get(ws.roomId) : null;

    if (!room) {
      return;
    }

    const me = [...room.clients].find(p => p.ws === ws);

    if (!me) {
      return;
    }

    room.clients.delete(me);

    /*
     * Se o administrador sair, passa o cargo
     * para a próxima pessoa da sala.
     */
    if (room.ownerId === me.peerId) {
      const next = [...room.clients][0];

      room.ownerId = next ? next.peerId : null;

      if (next) {
        send(next.ws, {
          type: "admin-promoted"
        });
      }
    }

    broadcast(room, {
      type: "participant-left",
      peerId: me.peerId
    });

    sendParticipants(room);

    cleanRoom(room);
  });
});

/*
 * HEARTBEAT
 */
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Hype Roleplay rodando na porta ${PORT}`);
});
