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

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "Hype Roleplay",
    time: new Date().toISOString()
  });
});

const rooms = new Map();

function cleanId(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);
}

function createRoomId() {
  let id;

  do {
    id = crypto.randomBytes(4).toString("hex").toUpperCase();
  } while (rooms.has(id));

  return id;
}

function createRoom(password = "") {
  const room = {
    id: createRoomId(),
    password: String(password || "").slice(0, 50),
    clients: new Set(),
    hostId: null,
    mutedAll: false
  };

  rooms.set(room.id, room);

  return room;
}

function send(ws, data) {
  if (ws && ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(data));
    } catch {}
  }
}

function broadcast(room, data, except = null) {
  for (const client of room.clients) {
    if (client !== except) {
      send(client.ws, data);
    }
  }
}

function participantData(client) {
  return {
    peerId: client.peerId,
    name: client.name,
    sharing: !!client.sharing,
    micOn: !!client.micOn,
    host: client.peerId === client.room.hostId
  };
}

function participantsList(room) {
  return [...room.clients].map(participantData);
}

function sendParticipants(room) {
  broadcast(room, {
    type: "participants",
    participants: participantsList(room),
    mutedAll: room.mutedAll
  });
}

function removeClient(ws) {
  const room = ws.room;

  if (!room) return;

  const client = [...room.clients].find(
    item => item.ws === ws
  );

  if (!client) return;

  room.clients.delete(client);

  broadcast(room, {
    type: "participant-left",
    peerId: client.peerId
  });

  // Se o administrador sair, passa a administração para outra pessoa.
  if (room.hostId === client.peerId) {
    const next = room.clients.values().next().value;

    room.hostId = next ? next.peerId : null;

    if (next) {
      send(next.ws, {
        type: "host-changed",
        host: true
      });
    }
  }

  sendParticipants(room);

  if (room.clients.size === 0) {
    rooms.delete(room.id);
  }
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
     * CRIAR SALA
     */
    if (msg.type === "create-room") {
      const room = createRoom(msg.password);

      send(ws, {
        type: "room-created",
        room: room.id,
        hasPassword: !!room.password
      });

      return;
    }

    /*
     * ENTRAR NA SALA
     */
    if (msg.type === "join") {
      const id = cleanId(msg.room);
      const name =
        String(msg.name || "Convidado")
          .trim()
          .slice(0, 30) || "Convidado";

      const password = String(msg.password || "");

      if (!id) {
        send(ws, {
          type: "error",
          message: "Sala inválida."
        });

        return;
      }

      const room = rooms.get(id);

      if (!room) {
        send(ws, {
          type: "error",
          message: "Essa sala não existe ou já foi encerrada."
        });

        return;
      }

      /*
       * SENHA
       */
      if (room.password && room.password !== password) {
        send(ws, {
          type: "password-required",
          message: "Essa sala possui uma senha."
        });

        return;
      }

      /*
       * LIMITE
       */
      if (room.clients.size >= MAX_PARTICIPANTS) {
        send(ws, {
          type: "error",
          message:
            `Esta sala atingiu o limite de ${MAX_PARTICIPANTS} participantes.`
        });

        return;
      }

      const peerId = crypto.randomUUID();

      const client = {
        ws,
        peerId,
        name,
        room,
        sharing: false,
        micOn: false
      };

      ws.room = room;
      ws.peerId = peerId;

      room.clients.add(client);

      /*
       * PRIMEIRO PARTICIPANTE = ADMIN
       */
      if (!room.hostId) {
        room.hostId = peerId;
      }

      /*
       * INFORMAÇÕES PARA QUEM ENTROU
       */
      send(ws, {
        type: "joined",
        peerId,
        room: room.id,
        host: room.hostId === peerId,
        mutedAll: room.mutedAll,
        participants: participantsList(room)
      });

      /*
       * AVISA OS OUTROS
       */
      broadcast(
        room,
        {
          type: "participant-joined",
          participant: participantData(client)
        },
        client
      );

      sendParticipants(room);

      return;
    }

    /*
     * A PARTIR DAQUI PRECISA ESTAR DENTRO DE UMA SALA
     */

    const room = ws.room;

    if (!room) {
      return;
    }

    const me = [...room.clients].find(
      client => client.ws === ws
    );

    if (!me) {
      return;
    }

    /*
     * WEBRTC SIGNALING
     */
    if (msg.type === "signal") {
      const target = [...room.clients].find(
        client => client.peerId === msg.to
      );

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
     * COMPARTILHAMENTO
     */
    if (msg.type === "sharing") {
      me.sharing = !!msg.value;

      sendParticipants(room);

      return;
    }

    /*
     * MICROFONE
     */
    if (msg.type === "mic") {
      me.micOn = !!msg.value;

      sendParticipants(room);

      return;
    }

    /*
     * MUTAR TODOS
     */
    if (msg.type === "mute-all") {
      if (me.peerId !== room.hostId) {
        send(ws, {
          type: "error",
          message:
            "Somente o administrador pode mutar todos."
        });

        return;
      }

      room.mutedAll = !!msg.value;

      broadcast(room, {
        type: "mute-all",
        value: room.mutedAll
      });

      sendParticipants(room);

      return;
    }

    /*
     * MUTAR UMA PESSOA
     */
    if (msg.type === "mute-peer") {
      if (me.peerId !== room.hostId) {
        send(ws, {
          type: "error",
          message:
            "Somente o administrador pode mutar participantes."
        });

        return;
      }

      const target = [...room.clients].find(
        client => client.peerId === msg.peerId
      );

      if (!target) {
        return;
      }

      target.micOn = false;

      send(target.ws, {
        type: "force-mute"
      });

      sendParticipants(room);

      return;
    }

    /*
     * CHAT
     */
    if (msg.type === "chat") {
      const text =
        String(msg.text || "")
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

  ws.on("close", () => {
    removeClient(ws);
  });

  ws.on("error", () => {
    removeClient(ws);
  });
});

/*
 * MANTÉM WEBSOCKETS VIVOS NO RENDER
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

/*
 * FALLBACK DO SITE
 *
 * IMPORTANTE:
 * NÃO usamos app.get("*"),
 * pois Express 5 apresenta erro com essa rota.
 */
app.use((req, res) => {
  if (req.method === "GET") {
    res.sendFile(
      path.join(__dirname, "public", "index.html")
    );
  } else {
    res.status(404).json({
      error: "Not found"
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Hype Roleplay rodando na porta ${PORT}`
  );
});
