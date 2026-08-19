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

  if (
    ws &&
    ws.readyState === 1
  ) {

    try {

      ws.send(
        JSON.stringify(message)
      );

    } catch (error) {

      console.error(
        "Erro ao enviar mensagem:",
        error
      );

    }

  }

}

function broadcast(
  room,
  message,
  except = null
) {

  for (const client of room.clients) {

    if (client.ws !== except) {

      send(
        client.ws,
        message
      );

    }

  }

}

function broadcastAll(
  room,
  message
) {

  for (const client of room.clients) {

    send(
      client.ws,
      message
    );

  }

}

/* =========================================================
   PARTICIPANTE
========================================================= */

function getParticipant(
  room,
  peerId
) {

  return [...room.clients].find(
    client =>
      client.peerId === peerId
  );

}

/* =========================================================
   ADMIN
========================================================= */

function isAdmin(
  room,
  ws
) {

  return (
    room.adminPeerId ===
    ws.peerId
  );

}

/* =========================================================
   LISTA DE PARTICIPANTES
========================================================= */

function participantsList(room) {

  return [...room.clients].map(
    participant => ({

      peerId:
        participant.peerId,

      name:
        participant.name,

      mobile:
        participant.mobile,

      sharing:
        participant.sharing,

      /*
       * TODOS entram mutados.
       */
      muted:
        participant.muted,

      admin:
        participant.peerId ===
        room.adminPeerId

    })
  );

}

/* =========================================================
   ATUALIZAR PARTICIPANTE
========================================================= */

function participantData(
  room,
  participant
) {

  return {

    peerId:
      participant.peerId,

    name:
      participant.name,

    mobile:
      participant.mobile,

    sharing:
      participant.sharing,

    muted:
      participant.muted,

    admin:
      participant.peerId ===
      room.adminPeerId

  };

}

function broadcastParticipantUpdate(
  room,
  participant
) {

  broadcastAll(
    room,
    {
      type:
        "participant-updated",

      participant:
        participantData(
          room,
          participant
        )
    }
  );

}

/* =========================================================
   WEBSOCKET
========================================================= */

wss.on(
  "connection",
  ws => {

    ws.isAlive = true;

    ws.on(
      "pong",
      () => {

        ws.isAlive = true;

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

          /*
           * IMPORTANTE:
           *
           * Todo usuário começa mutado.
           *
           * Isso vale para:
           * - ADM
           * - PC
           * - Android
           * - iPhone
           */

          const participant = {

            ws,

            peerId,

            name,

            mobile,

            sharing:
              false,

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

          /* ===============================================
             PRIMEIRO USUÁRIO = ADMIN
          =============================================== */

          if (
            !room.adminPeerId
          ) {

            room.adminPeerId =
              peerId;

          }

          room.clients.add(
            participant
          );

          /* ===============================================
             CONFIRMAÇÃO DE ENTRADA
          =============================================== */

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
                participantsList(
                  room
                )
            }
          );

          /* ===============================================
             AVISA OS OUTROS
          =============================================== */

          broadcast(
            room,
            {
              type:
                "participant-joined",

              participant:
                participantData(
                  room,
                  participant
                )
            },
            ws
          );

          /* ===============================================
             ATUALIZA TODOS
          =============================================== */

          broadcastAll(
            room,
            {
              type:
                "participants-refresh",

              participants:
                participantsList(
                  room
                )
            }
          );

          /*
           * Confirma explicitamente ao novo usuário
           * que ele entrou mutado.
           */

          send(
            ws,
            {
              type:
                "forced-mute",

              muted:
                true
            }
          );

          return;
        }

        /* =================================================
           LOCALIZAR SALA
        ================================================= */

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
           WEBRTC SIGNAL
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
           COMPARTILHAMENTO DE TELA
        ================================================= */

        if (
          msg.type ===
          "sharing"
        ) {

          /*
           * Celular não transmite.
           */

          if (
            me.mobile
          ) {

            return;

          }

          me.sharing =
            Boolean(
              msg.value
            );

          broadcastParticipantUpdate(
            room,
            me
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

          /*
           * Celular continua sem microfone.
           */

          if (
            me.mobile
          ) {

            me.muted =
              true;

            broadcastParticipantUpdate(
              room,
              me
            );

            return;
          }

          /*
           * O cliente informa se o microfone
           * está mutado.
           */

          me.muted =
            Boolean(
              msg.muted
            );

          broadcastParticipantUpdate(
            room,
            me
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
           ADMIN - MUTAR USUÁRIO
        ================================================= */

        if (
          msg.type ===
          "admin-mute"
        ) {

          if (
            !isAdmin(
              room,
              ws
            )
          ) {

            send(
              ws,
              {
                type:
                  "error",

                message:
                  "Somente o administrador pode fazer isso."
              }
            );

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

          broadcastParticipantUpdate(
            room,
            target
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
            !isAdmin(
              room,
              ws
            )
          ) {

            return;

          }

          /*
           * Agora o ADM também entra nessa regra:
           * todos ficam mutados.
           */

          for (
            const participant
            of room.clients
          ) {

            participant.muted =
              true;

            send(
              participant.ws,
              {
                type:
                  "forced-mute",

                muted:
                  true
              }
            );

          }

          broadcastAll(
            room,
            {
              type:
                "participants-refresh",

              participants:
                participantsList(
                  room
                )
            }
          );

          return;
        }

        /* =================================================
           ADMIN - PARAR COMPARTILHAMENTOS
        ================================================= */

        if (
          msg.type ===
          "admin-stop-shares"
        ) {

          if (
            !isAdmin(
              room,
              ws
            )
          ) {

            return;

          }

          for (
            const participant
            of room.clients
          ) {

            if (
              !participant.sharing
            ) {

              continue;

            }

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

          broadcastAll(
            room,
            {
              type:
                "participants-refresh",

              participants:
                participantsList(
                  room
                )
            }
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
            !isAdmin(
              room,
              ws
            )
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

          /*
           * ADM não pode expulsar ele mesmo.
           */

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

          /*
           * Avisar os demais imediatamente.
           */

          broadcast(
            room,
            {
              type:
                "participant-left",

              peerId:
                target.peerId
            },
            target.ws
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
       DESCONECTOU
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

        /*
         * Avisa todos que saiu.
         */

        broadcastAll(
          room,
          {
            type:
              "participant-left",

            peerId:
              me.peerId
          }
        );

        /* ===============================================
           ESCOLHER NOVO ADMIN
        =============================================== */

        if (
          wasAdmin &&
          room.clients.size > 0
        ) {

          const newAdmin =
            [...room.clients][0];

          room.adminPeerId =
            newAdmin.peerId;

          send(
            newAdmin.ws,
            {
              type:
                "admin-promoted"
            }
          );

          broadcastAll(
            room,
            {
              type:
                "participants-refresh",

              participants:
                participantsList(
                  room
                )
            }
          );

        }

        cleanRoom(
          room
        );

      }
    );

  }
);

/* =========================================================
   PING / PONG
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

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Hype Roleplay rodando na porta ${PORT}`
    );

  }
);
```
