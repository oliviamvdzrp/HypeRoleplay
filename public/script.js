"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 10000;

/* =========================================================
EXPRESS
========================================================= */

app.use(express.json());

app.use(
express.static(
path.join(__dirname, "public")
)
);

/* =========================================================
ROTAS
========================================================= */

app.get("/health", (req, res) => {
res.status(200).json({
ok: true,
service: "Hype Roleplay",
rooms: rooms.size
});
});

app.get("/", (req, res) => {
res.sendFile(
path.join(
__dirname,
"public",
"index.html"
)
);
});

/* =========================================================
WEBSOCKET
========================================================= */

const wss = new WebSocketServer({
server
});

/* =========================================================
SALAS
========================================================= */

const rooms = new Map();

function createRoom(roomId) {
const room = {
id: roomId,
clients: new Set(),
adminPeerId: null,
createdAt: Date.now()
};

rooms.set(roomId, room);

return room;
}

function getRoom(roomId) {
return rooms.get(roomId);
}

function getOrCreateRoom(roomId) {
return (
getRoom(roomId) ||
createRoom(roomId)
);
}

function removeEmptyRoom(room) {
if (
room &&
room.clients.size === 0
) {
rooms.delete(room.id);
}
}

/* =========================================================
PARTICIPANTES
========================================================= */

function findParticipant(
room,
peerId
) {
if (!room || !peerId) {
return null;
}

for (
const participant of room.clients
) {
if (
participant.peerId === peerId
) {
return participant;
}
}

return null;
}

function getParticipants(room) {
if (!room) {
return [];
}

return Array.from(
room.clients
).map(
participant => ({
peerId: participant.peerId,
name: participant.name,
mobile: participant.mobile,
sharing: participant.sharing,
muted: participant.muted,
admin:
participant.peerId ===
room.adminPeerId
})
);
}

/* =========================================================
WEBSOCKET HELPERS
========================================================= */

function send(ws, data) {
if (
!ws ||
ws.readyState !== 1
) {
return;
}

try {
ws.send(
JSON.stringify(data)
);
} catch (error) {
console.error(
"Erro ao enviar WebSocket:",
error.message
);
}
}

function broadcast(
room,
data,
exceptWs = null
) {
if (!room) {
return;
}

for (
const participant of room.clients
) {
if (
participant.ws !== exceptWs
) {
send(
participant.ws,
data
);
}
}
}

function broadcastAll(
room,
data
) {
if (!room) {
return;
}

for (
const participant of room.clients
) {
send(
participant.ws,
data
);
}
}

/* =========================================================
ATUALIZAR PARTICIPANTE
========================================================= */

function participantData(
room,
participant
) {
return {
peerId: participant.peerId,
name: participant.name,
mobile: participant.mobile,
sharing: participant.sharing,
muted: participant.muted,
admin:
participant.peerId ===
room.adminPeerId
};
}

/* =========================================================
WEBSOCKET CONNECTION
========================================================= */

wss.on(
"connection",
ws => {

```
ws.isAlive = true;

ws.roomId = null;
ws.peerId = null;

/* =====================================================
   PONG
===================================================== */

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
  rawData => {

    let msg;

    try {
      msg =
        JSON.parse(
          rawData.toString()
        );
    } catch (error) {

      send(
        ws,
        {
          type: "error",
          message:
            "Mensagem inválida."
        }
      );

      return;
    }

    if (
      !msg ||
      typeof msg.type !==
        "string"
    ) {
      return;
    }

    /* =================================================
       ENTRAR NA SALA
    ================================================= */

    if (
      msg.type === "join"
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
            type: "error",
            message:
              "Sala inválida."
          }
        );

        return;
      }

      /*
       * Impede a mesma conexão
       * de entrar em duas salas.
       */
      if (ws.roomId) {

        send(
          ws,
          {
            type: "error",
            message:
              "Você já está em uma sala."
          }
        );

        return;
      }

      const room =
        getOrCreateRoom(
          roomId
        );

      /*
       * Limite da sala.
       */
      if (
        room.clients.size >=
        12
      ) {

        send(
          ws,
          {
            type: "error",
            message:
              "A sala está cheia."
          }
        );

        return;
      }

      /*
       * ID único do participante.
       */
      const peerId =
        crypto.randomUUID();

      const participant = {
        ws,
        peerId,
        name,
        mobile,

        /*
         * Todo mundo entra mutado.
         */
        muted: true,

        /*
         * Ninguém começa
         * compartilhando.
         */
        sharing: false,

        joinedAt: Date.now()
      };

      ws.roomId =
        roomId;

      ws.peerId =
        peerId;

      room.clients.add(
        participant
      );

      /*
       * Primeiro participante
       * vira administrador.
       */
      if (
        !room.adminPeerId
      ) {

        room.adminPeerId =
          peerId;
      }

      /*
       * Confirmar entrada.
       */
      send(
        ws,
        {
          type: "joined",

          peerId,

          room: roomId,

          admin:
            room.adminPeerId ===
            peerId,

          participants:
            getParticipants(
              room
            )
        }
      );

      /*
       * Avisar os outros.
       */
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

      /*
       * Atualizar todos.
       */
      broadcastAll(
        room,
        {
          type:
            "participants-refresh",

          participants:
            getParticipants(
              room
            )
        }
      );

      console.log(
        `[SALA] ${roomId} - ${name} entrou (${room.clients.size}/12)`
      );

      return;
    }

    /* =================================================
       TODAS AS MENSAGENS ABAIXO
       PRECISAM DE UMA SALA
    ================================================= */

    const room =
      ws.roomId
        ? getRoom(
            ws.roomId
          )
        : null;

    if (!room) {

      send(
        ws,
        {
          type: "error",
          message:
            "Você não está em uma sala."
        }
      );

      return;
    }

    const me =
      findParticipant(
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
      msg.type === "signal"
    ) {

      const target =
        findParticipant(
          room,
          msg.to
        );

      if (!target) {
        return;
      }

      if (!msg.signal) {
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
      msg.type === "sharing"
    ) {

      /*
       * Celular não compartilha.
       */
      if (me.mobile) {

        send(
          ws,
          {
            type: "error",
            message:
              "Dispositivos móveis não podem compartilhar a tela."
          }
        );

        return;
      }

      me.sharing =
        Boolean(
          msg.value
        );

      broadcastAll(
        room,
        {
          type:
            "participant-updated",

          participant:
            participantData(
              room,
              me
            )
        }
      );

      return;
    }

    /* =================================================
       MICROFONE
    ================================================= */

    if (
      msg.type === "mic"
    ) {

      /*
       * Celular não utiliza
       * microfone neste projeto.
       */
      if (me.mobile) {
        return;
      }

      me.muted =
        Boolean(
          msg.muted
        );

      broadcastAll(
        room,
        {
          type:
            "participant-updated",

          participant:
            participantData(
              room,
              me
            )
        }
      );

      return;
    }

    /* =================================================
       CHAT
    ================================================= */

    if (
      msg.type === "chat"
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

    /* =================================================
       VERIFICAÇÃO DE ADMIN
    ================================================= */

    const adminRequest =
      msg.type ===
        "admin-mute" ||
      msg.type ===
        "admin-mute-all" ||
      msg.type ===
        "admin-stop-shares" ||
      msg.type ===
        "admin-kick";

    if (
      adminRequest &&
      room.adminPeerId !==
        me.peerId
    ) {

      send(
        ws,
        {
          type: "error",
          message:
            "Somente o administrador pode fazer isso."
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

      const target =
        findParticipant(
          room,
          msg.peerId
        );

      if (!target) {
        return;
      }

      /*
       * O admin não pode alterar
       * o próprio microfone por
       * este comando.
       */
      if (
        target.peerId ===
        me.peerId
      ) {
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

      broadcastAll(
        room,
        {
          type:
            "participant-updated",

          participant:
            participantData(
              room,
              target
            )
        }
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

      for (
        const participant
        of room.clients
      ) {

        if (
          participant.peerId ===
          me.peerId
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

      broadcastAll(
        room,
        {
          type:
            "participants-refresh",

          participants:
            getParticipants(
              room
            )
        }
      );

      return;
    }

    /* =================================================
       ADMIN - PARAR TRANSMISSÕES
    ================================================= */

    if (
      msg.type ===
      "admin-stop-shares"
    ) {

      for (
        const participant
        of room.clients
      ) {

        if (
          participant.peerId ===
          me.peerId
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
            getParticipants(
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

      const target =
        findParticipant(
          room,
          msg.peerId
        );

      if (!target) {
        return;
      }

      /*
       * Não permite expulsar
       * o próprio administrador.
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
   DESCONEXÃO
===================================================== */

ws.on(
  "close",
  () => {

    const room =
      ws.roomId
        ? getRoom(
            ws.roomId
          )
        : null;

    if (!room) {
      return;
    }

    const participant =
      findParticipant(
        room,
        ws.peerId
      );

    if (!participant) {
      return;
    }

    const wasAdmin =
      participant.peerId ===
      room.adminPeerId;

    room.clients.delete(
      participant
    );

    console.log(
      `[SALA] ${room.id} - ${participant.name} saiu (${room.clients.size}/12)`
    );

    /*
     * Avisar que saiu.
     */
    broadcastAll(
      room,
      {
        type:
          "participant-left",

        peerId:
          participant.peerId
      }
    );

    /*
     * Se o administrador saiu,
     * escolher outro.
     */
    if (
      wasAdmin &&
      room.clients.size > 0
    ) {

      const newAdmin =
        Array.from(
          room.clients
        )[0];

      room.adminPeerId =
        newAdmin.peerId;

      send(
        newAdmin.ws,
        {
          type:
            "admin-promoted"
        }
      );

      console.log(
        `[SALA] ${room.id} - novo administrador: ${newAdmin.name}`
      );
    }

    /*
     * Atualizar todos.
     */
    if (
      room.clients.size > 0
    ) {

      broadcastAll(
        room,
        {
          type:
            "participants-refresh",

          participants:
            getParticipants(
              room
            )
        }
      );

    } else {

      removeEmptyRoom(
        room
      );

      console.log(
        `[SALA] ${room.id} removida`
      );
    }

    ws.roomId = null;
    ws.peerId = null;
  }
);

/* =====================================================
   ERRO DO SOCKET
===================================================== */

ws.on(
  "error",
  error => {

    console.error(
      "WebSocket error:",
      error.message
    );
  }
);
```

}
);

/* =========================================================
PING / PONG
========================================================= */

const heartbeatInterval =
setInterval(
() => {

```
  for (
    const ws
    of wss.clients
  ) {

    if (
      ws.isAlive === false
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
```

);

/* =========================================================
ENCERRAMENTO
========================================================= */

wss.on(
"close",
() => {

```
clearInterval(
  heartbeatInterval
);
```

}
);

/* =========================================================
SERVIDOR
========================================================= */

server.on(
"error",
error => {

```
console.error(
  "Erro no servidor:",
  error
);
```

}
);

server.listen(
PORT,
"0.0.0.0",
() => {

```
console.log(
  "========================================"
);

console.log(
  "HYPE ROLEPLAY"
);

console.log(
  "Servidor iniciado com sucesso."
);

console.log(
  `Porta: ${PORT}`
);

console.log(
  "WebSocket: ativo"
);

console.log(
  "Salas: sistema ativo"
);

console.log(
  "========================================"
);
```

}
);
