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

/*
 * IMPORTANTE:
 * Como estamos usando Express 5, usamos app.use() para
 * o fallback da página.
 */
app.use((_req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});


/* =========================================================
   SALAS
========================================================= */

const rooms = new Map();


function createRoomId() {
  return crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase();
}


function send(ws, message) {
  if (
    ws &&
    ws.readyState === 1
  ) {
    ws.send(
      JSON.stringify(message)
    );
  }
}


function broadcast(room, message, except = null) {
  for (const participant of room.clients) {
    if (
      participant !== except
    ) {
      send(
        participant.ws,
        message
      );
    }
  }
}


function getRoom(id) {
  let room = rooms.get(id);

  if (!room) {
    room = {
      id,
      clients: new Set(),
      adminId: null
    };

    rooms.set(id, room);
  }

  return room;
}


function removeRoomIfEmpty(room) {
  if (
    room &&
    room.clients.size === 0
  ) {
    rooms.delete(room.id);
  }
}


function getParticipant(room, peerId) {
  return [...room.clients].find(
    p => p.peerId === peerId
  );
}


/* =========================================================
   PARTICIPANTES
========================================================= */

function publicParticipant(participant) {
  return {
    peerId: participant.peerId,
    name: participant.name,
    sharing: participant.sharing,
    muted: participant.muted,
    mobile: participant.mobile,
    admin: participant.admin
  };
}


/* =========================================================
   WEBSOCKET
========================================================= */

wss.on("connection", ws => {

  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });


  ws.on("message", raw => {

    let msg;

    try {
      msg = JSON.parse(
        raw.toString()
      );
    } catch {
      return;
    }


    /* =====================================================
       CRIAR / ENTRAR NA SALA
    ====================================================== */

    if (msg.type === "join") {

      const id = String(
        msg.room || ""
      )
        .replace(
          /[^a-zA-Z0-9_-]/g,
          ""
        )
        .slice(0, 32);


      const name =
        String(
          msg.name || "Convidado"
        )
          .trim()
          .slice(0, 30)
        || "Convidado";


      const mobile =
        Boolean(msg.mobile);


      if (!id) {

        send(ws, {
          type: "error",
          message: "Sala inválida."
        });

        return;
      }


      const room = getRoom(id);


      if (room.clients.size >= 12) {

        send(ws, {
          type: "error",
          message:
            "Esta sala atingiu o limite de 12 participantes."
        });

        return;
      }


      const peerId =
        crypto.randomUUID();


      const isFirst =
        room.clients.size === 0;


      const participant = {

        ws,

        peerId,

        name,

        mobile,

        sharing: false,

        muted: false,

        admin: isFirst

      };


      ws.roomId = id;
      ws.peerId = peerId;


      room.clients.add(
        participant
      );


      if (isFirst) {
        room.adminId = peerId;
      }


      send(ws, {

        type: "joined",

        peerId,

        room: id,

        admin:
          peerId === room.adminId,

        participants:
          [...room.clients]
            .map(publicParticipant)

      });


      broadcast(
        room,
        {
          type:
            "participant-joined",

          participant:
            publicParticipant(
              participant
            )
        },
        participant
      );


      return;
    }


    /* =====================================================
       LOCALIZAR SALA
    ====================================================== */

    const room = ws.roomId
      ? rooms.get(ws.roomId)
      : null;


    if (!room) {
      return;
    }


    const me =
      getParticipant(
        room,
        ws.peerId
      );


    if (!me) {
      return;
    }


    /* =====================================================
       WEBRTC SIGNALING
    ====================================================== */

    if (msg.type === "signal") {

      const target =
        getParticipant(
          room,
          msg.to
        );


      if (!target) {
        return;
      }


      send(
        target.ws,
        {
          type: "signal",

          from:
            me.peerId,

          fromName:
            me.name,

          signal:
            msg.signal
        }
      );


      return;
    }


    /* =====================================================
       COMPARTILHAMENTO
    ====================================================== */

    if (
      msg.type === "sharing"
    ) {

      /*
       * Celulares não podem transmitir.
       */

      if (
        me.mobile &&
        msg.value
      ) {

        send(ws, {
          type: "error",
          message:
            "No celular é permitido apenas assistir às transmissões."
        });

        return;
      }


      me.sharing =
        Boolean(msg.value);


      broadcast(
        room,
        {
          type:
            "participant-updated",

          participant:
            publicParticipant(
              me
            )
        }
      );


      return;
    }


    /* =====================================================
       MICROFONE
    ====================================================== */

    if (
      msg.type === "mic"
    ) {

      me.muted =
        Boolean(msg.muted);


      broadcast(
        room,
        {
          type:
            "participant-updated",

          participant:
            publicParticipant(
              me
            )
        }
      );


      return;
    }


    /* =====================================================
       CHAT
    ====================================================== */

    if (
      msg.type === "chat"
    ) {

      const text =
        String(
          msg.text || ""
        )
          .trim()
          .slice(0, 500);


      if (!text) {
        return;
      }


      broadcast(
        room,
        {
          type: "chat",

          from:
            me.name,

          peerId:
            me.peerId,

          text,

          at:
            Date.now()
        }
      );


      return;
    }


    /* =====================================================
       ADMIN - VERIFICAÇÃO
    ====================================================== */

    const isAdmin =
      me.peerId ===
      room.adminId;


    /* =====================================================
       ADMIN - EXPULSAR
    ====================================================== */

    if (
      msg.type === "admin-kick"
    ) {

      if (!isAdmin) {

        send(ws, {
          type: "error",
          message:
            "Você não é o administrador desta sala."
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


      if (
        target.peerId ===
        room.adminId
      ) {
        return;
      }


      send(
        target.ws,
        {
          type: "kicked",

          message:
            "Você foi removido da sala pelo administrador."
        }
      );


      try {
        target.ws.close();
      } catch {}


      return;
    }


    /* =====================================================
       ADMIN - MUTAR USUÁRIO
    ====================================================== */

    if (
      msg.type === "admin-mute"
    ) {

      if (!isAdmin) {

        send(ws, {
          type: "error",
          message:
            "Você não é o administrador desta sala."
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


      send(
        target.ws,
        {
          type:
            "forced-mute",

          muted:
            target.muted
        }
      );


      broadcast(
        room,
        {
          type:
            "participant-updated",

          participant:
            publicParticipant(
              target
            )
        }
      );


      return;
    }


    /* =====================================================
       ADMIN - MUTAR TODOS
    ====================================================== */

    if (
      msg.type ===
      "admin-mute-all"
    ) {

      if (!isAdmin) {

        send(ws, {
          type: "error",
          message:
            "Você não é o administrador desta sala."
        });

        return;
      }


      for (
        const participant
        of room.clients
      ) {

        if (
          participant.peerId ===
          room.adminId
        ) {
          continue;
        }


        participant.muted =
          true;


        send(
          participant.ws,
          {
            type:
              "forced-mute",

            muted: true
          }
        );
      }


      broadcast(
        room,
        {
          type:
            "participants-refresh",

          participants:
            [...room.clients]
              .map(publicParticipant)
        }
      );


      return;
    }


    /* =====================================================
       ADMIN - PARAR TRANSMISSÕES
    ====================================================== */

    if (
      msg.type ===
      "admin-stop-shares"
    ) {

      if (!isAdmin) {

        send(ws, {
          type: "error",
          message:
            "Você não é o administrador desta sala."
        });

        return;
      }


      for (
        const participant
        of room.clients
      ) {

        if (
          participant.sharing
        ) {

          participant.sharing =
            false;


          send(
            participant.ws,
            {
              type:
                "force-stop-share"
            }
          );
        }
      }


      broadcast(
        room,
        {
          type:
            "participants-refresh",

          participants:
            [...room.clients]
              .map(publicParticipant)
        }
      );


      return;
    }

  });


  /* =======================================================
     DESCONECTOU
  ======================================================== */

  ws.on("close", () => {

    const room =
      ws.roomId
        ? rooms.get(ws.roomId)
        : null;


    if (!room) {
      return;
    }


    const me =
      getParticipant(
        room,
        ws.peerId
      );


    if (!me) {
      return;
    }


    room.clients.delete(
      me
    );


    broadcast(
      room,
      {
        type:
          "participant-left",

        peerId:
          me.peerId
      }
    );


    /*
     * Se o administrador sair,
     * o próximo participante vira ADM.
     */

    if (
      me.peerId ===
      room.adminId
    ) {

      const next =
        [...room.clients][0];


      if (next) {

        room.adminId =
          next.peerId;

        next.admin =
          true;


        send(
          next.ws,
          {
            type:
              "admin-promoted"
          }
        );


        broadcast(
          room,
          {
            type:
              "participants-refresh",

            participants:
              [...room.clients]
                .map(publicParticipant)
          }
        );

      } else {

        room.adminId =
          null;
      }
    }


    removeRoomIfEmpty(
      room
    );

  });

});


/* =========================================================
   HEARTBEAT
========================================================= */

setInterval(() => {

  for (
    const ws
    of wss.clients
  ) {

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
