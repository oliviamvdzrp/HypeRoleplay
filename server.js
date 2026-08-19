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
   ARQUIVOS DO SITE
========================================================= */

app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "Hype Roleplay",
    time: new Date().toISOString()
  });
});

/* =========================================================
   SPA / INDEX
========================================================= */

app.use((req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

/* =========================================================
   SALAS
========================================================= */

const rooms = new Map();

function getRoom(id) {
  let room = rooms.get(id);

  if (!room) {
    room = {
      clients: new Set(),
      adminPeerId: null
    };

    rooms.set(id, room);
  }

  return room;
}

function cleanRoom(room) {
  if (room.clients.size === 0) {
    for (const [id, value] of rooms.entries()) {
      if (value === room) {
        rooms.delete(id);
      }
    }
  }
}

/* =========================================================
   ENVIO
========================================================= */

function send(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(room, message, except = null) {
  for (const client of room.clients) {
    if (client.ws !== except) {
      send(client.ws, message);
    }
  }
}

function broadcastAll(room, message) {
  for (const client of room.clients) {
    send(client.ws, message);
  }
}

function getParticipant(room, peerId) {
  return [...room.clients].find(
    client => client.peerId === peerId
  );
}

function isAdmin(room, ws) {
  return room.adminPeerId === ws.peerId;
}

/* =========================================================
   LISTA DE PARTICIPANTES
========================================================= */

function participantsList(room) {
  return [...room.clients].map(participant => ({
    peerId: participant.peerId,
    name: participant.name,
    mobile: participant.mobile,
    sharing: participant.sharing,
    muted: participant.muted,
    admin:
      participant.peerId === room.adminPeerId
  }));
}

/* =========================================================
   WEBSOCKET
========================================================= */

wss.on("connection", ws => {

  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  /* =======================================================
     MENSAGENS
  ======================================================= */

  ws.on("message", raw => {

    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    /* =====================================================
       ENTRAR NA SALA
    ===================================================== */

    if (msg.type === "join") {

      const roomId = String(msg.room || "")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 32);

      const name = String(
        msg.name || "Convidado"
      )
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

      const room = getRoom(roomId);

      if (room.clients.size >= 12) {

        send(ws, {
          type: "error",
          message:
            "Esta sala atingiu o limite de 12 participantes."
        });

        return;
      }

      const peerId = crypto.randomUUID();

      const participant = {
        ws,
        peerId,
        name,
        mobile,
        sharing: false,
        muted: false
      };

      ws.roomId = roomId;
      ws.peerId = peerId;
      ws.name = name;
      ws.mobile = mobile;

      /* ===================================================
         PRIMEIRO USUÁRIO = ADMIN
      =================================================== */

      if (!room.adminPeerId) {
        room.adminPeerId = peerId;
      }

      room.clients.add(participant);

      /* ===================================================
         CONFIRMAÇÃO DE ENTRADA
      =================================================== */

      send(ws, {
        type: "joined",
        peerId,
        room: roomId,
        admin:
          room.adminPeerId === peerId,
        participants:
          participantsList(room)
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
            muted: false,
            admin:
              room.adminPeerId === peerId
          }
        },
        ws
      );

      /* ===================================================
         ATUALIZA PARTICIPANTES
      =================================================== */

      broadcastAll(room, {
        type: "participants-refresh",
        participants:
          participantsList(room)
      });

      return;
    }

    /* =====================================================
       LOCALIZAR SALA
    ===================================================== */

    const room = ws.roomId
      ? rooms.get(ws.roomId)
      : null;

    if (!room) {
      return;
    }

    const me = getParticipant(
      room,
      ws.peerId
    );

    if (!me) {
      return;
    }

    /* =====================================================
       WEBRTC SIGNAL
    ===================================================== */

    if (msg.type === "signal") {

      const target = getParticipant(
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

      /* Celular não transmite */

      if (me.mobile) {
        return;
      }

      me.sharing =
        Boolean(msg.value);

      broadcastAll(room, {
        type: "participant-updated",
        participant: {
          peerId: me.peerId,
          name: me.name,
          mobile: me.mobile,
          sharing: me.sharing,
          muted: me.muted,
          admin:
            me.peerId ===
            room.adminPeerId
        }
      });

      return;
    }

    /* =====================================================
       MICROFONE
    ===================================================== */

    if (msg.type === "mic") {

      me.muted =
        Boolean(msg.muted);

      broadcastAll(room, {
        type: "participant-updated",
        participant: {
          peerId: me.peerId,
          name: me.name,
          mobile: me.mobile,
          sharing: me.sharing,
          muted: me.muted,
          admin:
            me.peerId ===
            room.adminPeerId
        }
      });

      return;
    }

    /* =====================================================
       CHAT
    ===================================================== */

    if (msg.type === "chat") {

      const text = String(
        msg.text || ""
      )
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
       ADMIN - MUTAR USUÁRIO
    ===================================================== */

    if (msg.type === "admin-mute") {

      if (!isAdmin(room, ws)) {

        send(ws, {
          type: "error",
          message:
            "Somente o administrador pode fazer isso."
        });

        return;
      }

      const target =
        getParticipant(
          room,
          msg.peerId
        );

      if (!target) {
        return;
      }

      target.muted =
        Boolean(msg.muted);

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
          admin:
            target.peerId ===
            room.adminPeerId
        }
      });

      return;
    }

    /* =====================================================
       ADMIN - MUTAR TODOS
    ===================================================== */

    if (msg.type === "admin-mute-all") {

      if (!isAdmin(room, ws)) {
        return;
      }

      for (const participant of room.clients) {

        if (
          participant.peerId ===
          room.adminPeerId
        ) {
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
        participants:
          participantsList(room)
      });

      return;
    }

    /* =====================================================
       ADMIN - PARAR COMPARTILHAMENTOS
    ===================================================== */

    if (msg.type === "admin-stop-shares") {

      if (!isAdmin(room, ws)) {
        return;
      }

      for (const participant of room.clients) {

        if (
          participant.peerId ===
          room.adminPeerId
        ) {
          continue;
        }

        participant.sharing = false;

        send(participant.ws, {
          type: "force-stop-share"
        });
      }

      broadcastAll(room, {
        type: "participants-refresh",
        participants:
          participantsList(room)
      });

      return;
    }

    /* =====================================================
       ADMIN - EXPULSAR
    ===================================================== */

    if (msg.type === "admin-kick") {

      if (!isAdmin(room, ws)) {
        return;
      }

      const target =
        getParticipant(
          room,
          msg.peerId
        );

      if (!target) {
        return;
      }

      /* ADM não pode expulsar ele mesmo */

      if (
        target.peerId ===
        room.adminPeerId
      ) {
        return;
      }

      send(target.ws, {
        type: "kicked",
        message:
          "Você foi removido da sala pelo administrador."
      });

      setTimeout(() => {

        try {
          target.ws.close(
            4001,
            "Kicked"
          );
        } catch {}

      }, 300);

      return;
    }

  });

  /* =======================================================
     DESCONECTOU
  ======================================================= */

  ws.on("close", () => {

    const room = ws.roomId
      ? rooms.get(ws.roomId)
      : null;

    if (!room) {
      return;
    }

    const me = getParticipant(
      room,
      ws.peerId
    );

    if (!me) {
      return;
    }

    const wasAdmin =
      room.adminPeerId ===
      me.peerId;

    room.clients.delete(me);

    broadcastAll(room, {
      type: "participant-left",
      peerId: me.peerId
    });

    /* =====================================================
       ESCOLHER NOVO ADMIN
    ===================================================== */

    if (
      wasAdmin &&
      room.clients.size > 0
    ) {

      const newAdmin =
        [...room.clients][0];

      room.adminPeerId =
        newAdmin.peerId;

      send(newAdmin.ws, {
        type: "admin-promoted"
      });

      broadcastAll(room, {
        type: "participants-refresh",
        participants:
          participantsList(room)
      });
    }

    cleanRoom(room);
  });

});

/* =========================================================
   PING / PONG
========================================================= */

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

/* =========================================================
   SERVIDOR
========================================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Hype Roleplay rodando na porta ${PORT}`
    );

  }
);
