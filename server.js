```javascript
const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 10000;

/* =========================================================
   SITE
========================================================= */

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "Hype Roleplay"
  });
});

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

/* =========================================================
   SALAS
========================================================= */

const rooms = new Map();

function createRoom(roomId) {
  const room = {
    id: roomId,
    clients: new Set(),
    adminPeerId: null
  };

  rooms.set(roomId, room);

  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function getOrCreateRoom(roomId) {
  return getRoom(roomId) || createRoom(roomId);
}

function removeEmptyRoom(room) {
  if (room.clients.size === 0) {
    rooms.delete(room.id);
  }
}

/* =========================================================
   PARTICIPANTES
========================================================= */

function findParticipant(room, peerId) {
  for (const participant of room.clients) {
    if (participant.peerId === peerId) {
      return participant;
    }
  }

  return null;
}

function getParticipants(room) {
  return Array.from(room.clients).map((participant) => ({
    peerId: participant.peerId,
    name: participant.name,
    mobile: participant.mobile,
    sharing: participant.sharing,
    muted: participant.muted,
    admin: participant.peerId === room.adminPeerId
  }));
}

/* =========================================================
   WEBSOCKET
========================================================= */

function send(ws, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data, exceptWs = null) {
  for (const participant of room.clients) {
    if (participant.ws !== exceptWs) {
      send(participant.ws, data);
    }
  }
}

function broadcastAll(room, data) {
  for (const participant of room.clients) {
    send(participant.ws, data);
  }
}

/* =========================================================
   CONEXÃO
========================================================= */

wss.on("connection", (ws) => {

  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  /* =======================================================
     MENSAGENS
  ======================================================= */

  ws.on("message", (data) => {

    let msg;

    try {
      msg = JSON.parse(data.toString());
    } catch (error) {
      return;
    }

    /* =====================================================
       ENTRAR
    ===================================================== */

    if (msg.type === "join") {

      const roomId = String(msg.room || "")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 32);

      const name = String(msg.name || "Convidado")
        .trim()
        .slice(0, 30) || "Convidado";

      const mobile = Boolean(msg.mobile);

      if (!roomId) {
        send(ws, {
          type: "error",
          message: "Sala inválida."
        });

        return;
      }

      const room = getOrCreateRoom(roomId);

      if (room.clients.size >= 12) {

        send(ws, {
          type: "error",
          message: "A sala está cheia."
        });

        return;
      }

      const peerId = crypto.randomUUID();

      const participant = {
        ws,
        peerId,
        name,
        mobile,

        /* Todo mundo entra mutado */
        muted: true,

        /* Ninguém começa compartilhando */
        sharing: false
      };

      ws.roomId = roomId;
      ws.peerId = peerId;

      room.clients.add(participant);

      /* Primeiro participante é administrador */
      if (!room.adminPeerId) {
        room.adminPeerId = peerId;
      }

      /* ===================================================
         AVISA QUEM ENTROU
      =================================================== */

      send(ws, {
        type: "joined",
        peerId,
        room: roomId,
        admin: room.adminPeerId === peerId,
        participants: getParticipants(room)
      });

      /* ===================================================
         AVISA OS OUTROS
      =================================================== */

      broadcast(
        room,
        {
          type: "participant-joined",
          participant: {
            peerId,
            name,
            mobile,
            sharing: false,
            muted: true,
            admin: room.adminPeerId === peerId
          }
        },
        ws
      );

      /* ===================================================
         ATUALIZA LISTA
      =================================================== */

      broadcastAll(room, {
        type: "participants-refresh",
        participants: getParticipants(room)
      });

      return;
    }

    /* =====================================================
       SALA DA CONEXÃO
    ===================================================== */

    const room = ws.roomId
      ? getRoom(ws.roomId)
      : null;

    if (!room) {
      return;
    }

    const me = findParticipant(
      room,
      ws.peerId
    );

    if (!me) {
      return;
    }

    /* =====================================================
       WEBRTC
    ===================================================== */

    if (msg.type === "signal") {

      const target = findParticipant(
        room,
        msg.to
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

    /* =====================================================
       COMPARTILHAMENTO
    ===================================================== */

    if (msg.type === "sharing") {

      if (me.mobile) {
        return;
      }

      me.sharing = Boolean(msg.value);

      broadcastAll(room, {
        type: "participant-updated",
        participant: {
          peerId: me.peerId,
          name: me.name,
          mobile: me.mobile,
          sharing: me.sharing,
          muted: me.muted,
          admin: me.peerId === room.adminPeerId
        }
      });

      return;
    }

    /* =====================================================
       MICROFONE
    ===================================================== */

    if (msg.type === "mic") {

      me.muted = Boolean(msg.muted);

      broadcastAll(room, {
        type: "participant-updated",
        participant: {
          peerId: me.peerId,
          name: me.name,
          mobile: me.mobile,
          sharing: me.sharing,
          muted: me.muted,
          admin: me.peerId === room.adminPeerId
        }
      });

      return;
    }

    /* =====================================================
       CHAT
    ===================================================== */

    if (msg.type === "chat") {

      const text = String(msg.text || "")
        .trim()
        .slice(0, 500);

      if (!text) {
        return;
      }

      broadcastAll(room, {
        type: "chat",
        from: me.name,
        peerId: me.peerId,
        text,
        at: Date.now()
      });

      return;
    }

    /* =====================================================
       ADMIN
    ===================================================== */

    const adminRequest =
      msg.type === "admin-mute" ||
      msg.type === "admin-mute-all" ||
      msg.type === "admin-stop-shares" ||
      msg.type === "admin-kick";

    if (adminRequest) {

      if (room.adminPeerId !== me.peerId) {

        send(ws, {
          type: "error",
          message: "Somente o administrador pode fazer isso."
        });

        return;
      }
    }

    /* =====================================================
       ADMIN - MUTAR USUÁRIO
    ===================================================== */

    if (msg.type === "admin-mute") {

      const target = findParticipant(
        room,
        msg.peerId
      );

      if (!target) {
        return;
      }

      target.muted = Boolean(msg.muted);

      send(target.ws, {
        type: "forced-mute",
        muted: target.muted
      });

      broadcastAll(room, {
        type: "participant-updated",
        participant: {
          peerId: target.peerId,
          name: target.name,
          mobile: target.mobile,
          sharing: target.sharing,
          muted: target.muted,
          admin: target.peerId === room.adminPeerId
        }
      });

      return;
    }

    /* =====================================================
       ADMIN - MUTAR TODOS
    ===================================================== */

    if (msg.type === "admin-mute-all") {

      for (const participant of room.clients) {

        if (participant.peerId === me.peerId) {
          continue;
        }

        participant.muted = true;

        send(participant.ws, {
          type: "forced-mute",
          muted: true
        });
      }

      broadcastAll(room, {
        type: "participants-refresh",
        participants: getParticipants(room)
      });

      return;
    }

    /* =====================================================
       ADMIN - PARAR TRANSMISSÕES
    ===================================================== */

    if (msg.type === "admin-stop-shares") {

      for (const participant of room.clients) {

        if (participant.peerId === me.peerId) {
          continue;
        }

        participant.sharing = false;

        send(participant.ws, {
          type: "force-stop-share"
        });
      }

      broadcastAll(room, {
        type: "participants-refresh",
        participants: getParticipants(room)
      });

      return;
    }

    /* =====================================================
       ADMIN - EXPULSAR
    ===================================================== */

    if (msg.type === "admin-kick") {

      const target = findParticipant(
        room,
        msg.peerId
      );

      if (!target) {
        return;
      }

      if (target.peerId === room.adminPeerId) {
        return;
      }

      send(target.ws, {
        type: "kicked",
        message: "Você foi removido da sala pelo administrador."
      });

      setTimeout(() => {
        try {
          target.ws.close(4001, "Kicked");
        } catch (error) {}
      }, 300);

      return;
    }
  });

  /* =======================================================
     DESCONEXÃO
  ======================================================= */

  ws.on("close", () => {

    const room = ws.roomId
      ? getRoom(ws.roomId)
      : null;

    if (!room) {
      return;
    }

    const participant = findParticipant(
      room,
      ws.peerId
    );

    if (!participant) {
      return;
    }

    const wasAdmin =
      participant.peerId === room.adminPeerId;

    room.clients.delete(participant);

    /* Avisar que saiu */
    broadcastAll(room, {
      type: "participant-left",
      peerId: participant.peerId
    });

    /* ===================================================
       NOVO ADMIN
    =================================================== */

    if (
      wasAdmin &&
      room.clients.size > 0
    ) {

      const newAdmin =
        Array.from(room.clients)[0];

      room.adminPeerId =
        newAdmin.peerId;

      send(newAdmin.ws, {
        type: "admin-promoted"
      });
    }

    /* ===================================================
       ATUALIZAR TODOS
    =================================================== */

    if (room.clients.size > 0) {

      broadcastAll(room, {
        type: "participants-refresh",
        participants: getParticipants(room)
      });

    } else {

      removeEmptyRoom(room);

    }
  });
});

/* =========================================================
   PING
========================================================= */

setInterval(() => {

  for (const ws of wss.clients) {

    if (!ws.isAlive) {

      try {
        ws.terminate();
      } catch (error) {}

      continue;
    }

    ws.isAlive = false;

    try {
      ws.ping();
    } catch (error) {}
  }

}, 30000);

/* =========================================================
   SERVIDOR
========================================================= */

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    "Hype Roleplay rodando na porta " + PORT
  );
});
```
