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
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});


/* =========================================================
   SALAS
========================================================= */

const rooms = new Map();


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


function broadcast(
  room,
  message,
  except = null
) {

  for (
    const participant of room.clients
  ) {

    if (
      participant.ws !== except
    ) {

      send(
        participant.ws,
        message
      );

    }

  }

}


function getRoom(id) {

  let room =
    rooms.get(id);

  if (!room) {

    room = {
      clients: new Set(),
      adminId: null
    };

    rooms.set(
      id,
      room
    );

  }

  return room;

}


function cleanRoom(room) {

  if (
    room.clients.size === 0
  ) {

    for (
      const [id, currentRoom]
      of rooms
    ) {

      if (
        currentRoom === room
      ) {

        rooms.delete(id);

      }

    }

  }

}


/* =========================================================
   PARTICIPANTE
========================================================= */

function participantInfo(
  participant
) {

  return {
    peerId: participant.peerId,
    name: participant.name,
    sharing: participant.sharing,
    muted: participant.muted,
    mobile: participant.mobile,
    admin:
      participant.peerId ===
      participant.room.adminId
  };

}


function sendParticipants(
  room
) {

  const list =
    [...room.clients]
      .map(
        participantInfo
      );

  broadcast(
    room,
    {
      type:
        "participants-refresh",
      participants:
        list
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

          const id =
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


          if (!id) {

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
            getRoom(id);


          if (
            room.clients.size >= 12
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
            mobile:
              Boolean(
                msg.mobile
              ),
            sharing: false,
            muted: true,
            room
          };


          ws.roomId =
            id;

          ws.peerId =
            peerId;

          ws.name =
            name;


          room.clients.add(
            participant
          );


          /* Primeiro usuário = ADM */

          if (
            !room.adminId
          ) {

            room.adminId =
              peerId;

          }


          const participants =
            [...room.clients]
              .map(
                participantInfo
              );


          send(
            ws,
            {
              type:
                "joined",

              peerId,

              room:
                id,

              admin:
                peerId ===
                room.adminId,

              participants
            }
          );


          broadcast(
            room,
            {
              type:
                "participant-joined",

              participant:
                participantInfo(
                  participant
                )
            },
            ws
          );


          sendParticipants(
            room
          );


          return;

        }


        /* =================================================
           VERIFICAR SALA
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
          [...room.clients]
            .find(
              participant =>
                participant.ws ===
                ws
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
            [...room.clients]
              .find(
                participant =>
                  participant.peerId ===
                  msg.to
              );


          if (
            target
          ) {

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

          }


          return;

        }


        /* =================================================
           COMPARTILHAMENTO
        ================================================= */

        if (
          msg.type ===
          "sharing"
        ) {

          me.sharing =
            Boolean(
              msg.value
            );


          sendParticipants(
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


          sendParticipants(
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


          broadcast(
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
           FUNÇÕES DO ADM
        ================================================= */

        const isAdmin =
          me.peerId ===
          room.adminId;


        /* =================================================
           ADM MUTE USUÁRIO
        ================================================= */

        if (
          msg.type ===
          "admin-mute"
        ) {

          if (!isAdmin) {
            return;
          }


          const target =
            [...room.clients]
              .find(
                participant =>
                  participant.peerId ===
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


          sendParticipants(
            room
          );


          return;

        }


        /* =================================================
           ADM MUTE TODOS
        ================================================= */

        if (
          msg.type ===
          "admin-mute-all"
        ) {

          if (!isAdmin) {
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

                muted:
                  true
              }
            );

          }


          sendParticipants(
            room
          );


          return;

        }


        /* =================================================
           ADM PARAR TRANSMISSÕES
        ================================================= */

        if (
          msg.type ===
          "admin-stop-shares"
        ) {

          if (!isAdmin) {
            return;
          }


          for (
            const participant
            of room.clients
          ) {

            participant.sharing =
              false;


            if (
              participant.peerId !==
              room.adminId
            ) {

              send(
                participant.ws,
                {
                  type:
                    "force-stop-share"
                }
              );

            }

          }


          sendParticipants(
            room
          );


          return;

        }


        /* =================================================
           ADM EXPULSAR
        ================================================= */

        if (
          msg.type ===
          "admin-kick"
        ) {

          if (!isAdmin) {
            return;
          }


          const target =
            [...room.clients]
              .find(
                participant =>
                  participant.peerId ===
                  msg.peerId
              );


          if (!target) {
            return;
          }


          /* ADM não pode expulsar ele mesmo */

          if (
            target.peerId ===
            room.adminId
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
            200
          );


          return;

        }


        /* =================================================
           TRANSFERIR ADM
        ================================================= */

        if (
          msg.type ===
          "admin-promote"
        ) {

          if (!isAdmin) {
            return;
          }


          const target =
            [...room.clients]
              .find(
                participant =>
                  participant.peerId ===
                  msg.peerId
              );


          if (!target) {
            return;
          }


          room.adminId =
            target.peerId;


          send(
            target.ws,
            {
              type:
                "admin-promoted"
            }
          );


          sendParticipants(
            room
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
          [...room.clients]
            .find(
              participant =>
                participant.ws ===
                ws
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


        /* ===============================================
           SE O ADM SAIR, PASSA PARA OUTRO
        =============================================== */

        if (
          room.adminId ===
          me.peerId
        ) {

          const nextAdmin =
            [...room.clients][0];


          if (nextAdmin) {

            room.adminId =
              nextAdmin.peerId;


            send(
              nextAdmin.ws,
              {
                type:
                  "admin-promoted"
              }
            );

          } else {

            room.adminId =
              null;

          }

        }


        sendParticipants(
          room
        );


        cleanRoom(
          room
        );

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

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Hype Roleplay rodando na porta ${PORT}`
    );

  }
);
