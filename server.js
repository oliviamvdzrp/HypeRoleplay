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

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "Hype Roleplay",
    time: new Date().toISOString()
  });
});

/* =========================================================
   INDEX
========================================================= */

app.use((_req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

/* =========================================================
   SALAS
========================================================= */

const rooms = new Map();

function getRoom(roomId) {

  if (!rooms.has(roomId)) {

    rooms.set(roomId, {
      clients: new Set(),
      adminPeerId: null
    });

  }

  return rooms.get(roomId);
}

/* =========================================================
   WEBSOCKET
========================================================= */

function send(ws, data) {

  if (
    ws &&
    ws.readyState === 1
  ) {

    ws.send(
      JSON.stringify(data)
    );

  }

}

function broadcast(
  room,
  data,
  except = null
) {

  for (
    const client
    of room.clients
  ) {

    if (
      client.ws !== except
    ) {

      send(
        client.ws,
        data
      );

    }

  }

}

function broadcastAll(
  room,
  data
) {

  for (
    const client
    of room.clients
  ) {

    send(
      client.ws,
      data
    );

  }

}

/* =========================================================
   PARTICIPANTES
========================================================= */

function getParticipant(
  room,
  peerId
) {

  return [
    ...room.clients
  ].find(
    client =>
      client.peerId === peerId
  );

}

function getParticipants(
  room
) {

  return [
    ...room.clients
  ].map(
    client => ({

      peerId:
        client.peerId,

      name:
        client.name,

      mobile:
        client.mobile,

      sharing:
        client.sharing,

      muted:
        client.muted,

      admin:
        client.peerId ===
        room.adminPeerId

    })
  );

}

function updateParticipants(
  room
) {

  broadcastAll(
    room,
    {
      type:
        "participants-refresh",

      participants:
        getParticipants(room)
    }
  );

}

/* =========================================================
   CONEXÃO
========================================================= */

wss.on(
  "connection",
  ws => {

    ws.isAlive = true;

    ws.on(
      "pong",
      () => {

        ws.isAlive =
          true;

      }
    );

    /* =====================================================
       MENSAGENS
    ===================================================== */

    ws.on(
      "message",
      raw => {

        let msg;

        try {

          msg =
            JSON.parse(
              raw.toString()
            );

        } catch {

          return;

        }

        /* =================================================
           ENTRAR NA SALA
        ================================================= */

        if (
          msg.type ===
          "join"
        ) {

          const roomId =
            String(
              msg.room || ""
            )
              .replace(
                /[^a-zA-Z0-9_-]/g,
                ""
              )
              .slice(
                0,
                32
              );

          const name =
            String(
              msg.name ||
              "Convidado"
            )
              .trim()
              .slice(
                0,
                30
              ) ||
            "Convidado";

          const mobile =
            Boolean(
              msg.mobile
            );

          if (!roomId) {

            send(
              ws,
              {
                type:
                  "error",

                message:
                  "Sala inválida."
              }
            );

            return;

          }

          const room =
            getRoom(roomId);

          if (
            room.clients.size >=
            12
          ) {

            send(
              ws,
              {
                type:
                  "error",

                message:
                  "Esta sala atingiu o limite de 12 participantes."
              }
            );

            return;

          }

          const peerId =
            crypto.randomUUID();

          const participant = {

            ws,

            peerId,

            name,

            mobile,

            sharing:
              false,

            /* TODO MUNDO COMEÇA MUTADO */

            muted:
              true

          };

          ws.roomId =
            roomId;

          ws.peerId =
            peerId;

          ws.name =
            name;

          ws.mobile =
            mobile;

          /* =================================================
             PRIMEIRO = ADMIN
          ================================================= */

          if (
            !room.adminPeerId
          ) {

            room.adminPeerId =
              peerId;

          }

          room.clients.add(
            participant
          );

          /* =================================================
             CONFIRMAÇÃO
          ================================================= */

          send(
            ws,
            {
              type:
                "joined",

              peerId,

              room:
                roomId,

              admin:
                room.adminPeerId ===
                peerId,

              participants:
                getParticipants(room)
            }
          );

          /* =================================================
             AVISAR QUEM JÁ ESTÁ NA SALA
          ================================================= */

          broadcast(
            room,
            {
              type:
                "participant-joined",

              participant: {

                peerId,

                name,

                mobile,

                sharing:
                  false,

                muted:
                  true,

                admin:
                  room.adminPeerId ===
                  peerId

              }
            },
            ws
          );

          /* =================================================
             ATUALIZAR LISTA
          ================================================= */

          updateParticipants(
            room
          );

          return;

        }

        /* ===================================================
           LOCALIZAR SALA
        =================================================== */

        const room =
          ws.roomId
            ? rooms.get(
                ws.roomId
              )
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

        /* =================================================
           WEBRTC
        ================================================= */

        if (
          msg.type ===
          "signal"
        ) {

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

              type:
                "signal",

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

        /* =================================================
           COMPARTILHAMENTO
        ================================================= */

        if (
          msg.type ===
          "sharing"
        ) {

          /* CELULAR NÃO COMPARTILHA */

          if (
            me.mobile
          ) {

            return;

          }

          me.sharing =
            Boolean(
              msg.value
            );

          updateParticipants(
            room
          );

          return;

        }

        /* =================================================
           MICROFONE
        ================================================= */

        if (
          msg.type ===
          "mic"
        ) {

          me.muted =
            Boolean(
              msg.muted
            );

          updateParticipants(
            room
          );

          return;

        }

        /* =================================================
           CHAT
        ================================================= */

        if (
          msg.type ===
          "chat"
        ) {

          const text =
            String(
              msg.text || ""
            )
              .trim()
              .slice(
                0,
                500
              );

          if (!text) {
            return;
          }

          broadcastAll(
            room,
            {

              type:
                "chat",

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

        /* =================================================
           ADMIN - MUTAR
        ================================================= */

        if (
          msg.type ===
          "admin-mute"
        ) {

          if (
            room.adminPeerId !==
            me.peerId
          ) {

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
            Boolean(
              msg.muted
            );

          send(
            target.ws,
            {

              type:
                "forced-mute",

              muted:
                target.muted

            }
          );

          updateParticipants(
            room
          );

          return;

        }

        /* =================================================
           ADMIN - MUTAR TODOS
        ================================================= */

        if (
          msg.type ===
          "admin-mute-all"
        ) {

          if (
            room.adminPeerId !==
            me.peerId
          ) {

            return;

          }

          for (
            const client
            of room.clients
          ) {

            if (
              client.peerId ===
              room.adminPeerId
            ) {

              continue;

            }

            client.muted =
              true;

            send(
              client.ws,
              {

                type:
                  "forced-mute",

                muted:
                  true

              }
            );

          }

          updateParticipants(
            room
          );

          return;

        }

        /* =================================================
           ADMIN - PARAR TELAS
        ================================================= */

        if (
          msg.type ===
          "admin-stop-shares"
        ) {

          if (
            room.adminPeerId !==
            me.peerId
          ) {

            return;

          }

          for (
            const client
            of room.clients
          ) {

            if (
              client.peerId ===
              room.adminPeerId
            ) {

              continue;

            }

            client.sharing =
              false;

            send(
              client.ws,
              {
                type:
                  "force-stop-share"
              }
            );

          }

          updateParticipants(
            room
          );

          return;

        }

        /* =================================================
           ADMIN - EXPULSAR
        ================================================= */

        if (
          msg.type ===
          "admin-kick"
        ) {

          if (
            room.adminPeerId !==
            me.peerId
          ) {

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

          /* NÃO PODE EXPULSAR O ADMIN */

          if (
            target.peerId ===
            room.adminPeerId
          ) {

            return;

          }

          send(
            target.ws,
            {

              type:
                "kicked",

              message:
                "Você foi removido da sala pelo administrador."

            }
          );

          setTimeout(
            () => {

              try {

                target.ws.close(
                  4001,
                  "Kicked"
                );

              } catch {}

            },
            300
          );

          return;

        }

      }
    );

    /* =====================================================
       SAÍDA
    ===================================================== */

    ws.on(
      "close",
      () => {

        const room =
          ws.roomId
            ? rooms.get(
                ws.roomId
              )
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

        const wasAdmin =
          room.adminPeerId ===
          me.peerId;

        room.clients.delete(
          me
        );

        /* AVISAR QUE SAIU */

        broadcastAll(
          room,
          {

            type:
              "participant-left",

            peerId:
              me.peerId

          }
        );

        /* =================================================
           NOVO ADMIN
        ================================================= */

        if (
          wasAdmin &&
          room.clients.size > 0
        ) {

          const newAdmin =
            [
              ...room.clients
            ][0];

          room.adminPeerId =
            newAdmin.peerId;

          send(
            newAdmin.ws,
            {
              type:
                "admin-promoted"
            }
          );

        }

        if (
          room.clients.size ===
          0
        ) {

          rooms.delete(
            ws.roomId
          );

        } else {

          updateParticipants(
            room
          );

        }

      }
    );

  }
);

/* =========================================================
   PING
========================================================= */

setInterval(
  () => {

    for (
      const ws
      of wss.clients
    ) {

      if (
        !ws.isAlive
      ) {

        try {

          ws.terminate();

        } catch {}

        continue;

      }

      ws.isAlive =
        false;

      try {

        ws.ping();

      } catch {}

    }

  },
  30000
);

/* =========================================================
   SERVIDOR
========================================================= */

server.listen(PORT, "0.0.0.0", () => {
  console.log("Hype Roleplay rodando na porta " + PORT);
});
