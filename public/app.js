```javascript
/* =========================================================
   HYPE ROLEPLAY
   Compartilhamento de tela - WebRTC
   app.js
========================================================= */

"use strict";

/* =========================================================
   ELEMENTOS
========================================================= */

const $ = (id) => document.getElementById(id);

const home = $("home");
const roomPage = $("room");

const nameHome = $("nameHome");
const roomInput = $("roomInput");

const createBtn = $("createBtn");
const joinBtn = $("joinBtn");

const roomCodeEl = $("roomCode");
const roomStatus = $("roomStatus");

const copyBtn = $("copyBtn");
const leaveBtn = $("leaveBtn");

const shareBtn = $("shareBtn");
const shareCenterBtn = $("shareCenterBtn");
const stopShareBtn = $("stopShareBtn");

const micBtn = $("micBtn");
const inviteBtn = $("inviteBtn");

const videos = $("videos");
const emptyState = $("emptyState");

const participantsEl = $("participants");
const countEl = $("count");

const chatForm = $("chatForm");
const chatInput = $("chatInput");
const chatMessages = $("chatMessages");

const toastEl = $("toast");

const adminPanel = $("adminPanel");
const adminButton = $("adminButton");


/* =========================================================
   ESTADO
========================================================= */

let socket = null;

let roomId = "";
let myPeerId = "";
let myName = "";

let isAdmin = false;
let isMobile = false;

let localScreenStream = null;
let localMicStream = null;

let micEnabled = false;

const peers = new Map();
const participants = new Map();

const reconnectState = {
  attempts: 0,
  timer: null
};

let toastTimer = null;


/* =========================================================
   MOBILE
========================================================= */

function detectMobile() {
  const ua = navigator.userAgent || "";

  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

isMobile = detectMobile();


/* =========================================================
   TOAST
========================================================= */

function toast(message) {
  if (!toastEl) {
    alert(message);
    return;
  }

  toastEl.textContent = message;
  toastEl.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toastEl.classList.remove("show");
  }, 3000);
}


/* =========================================================
   URL
========================================================= */

function getRoomFromUrl() {
  try {
    const url = new URL(window.location.href);

    return (
      url.searchParams.get("room") || ""
    ).trim();
  } catch {
    return "";
  }
}


function updateUrl(room) {
  try {
    const url = new URL(window.location.href);

    url.searchParams.set("room", room);

    history.replaceState({}, "", url);
  } catch {}
}


/* =========================================================
   GERAR SALA
========================================================= */

function generateRoom() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let result = "";

  for (let i = 0; i < 6; i++) {
    result += chars[
      Math.floor(
        Math.random() * chars.length
      )
    ];
  }

  return result;
}


/* =========================================================
   CRIAR SALA
========================================================= */

createBtn?.addEventListener("click", () => {
  const name = nameHome?.value.trim();

  if (!name) {
    toast("Digite seu nome primeiro.");
    nameHome?.focus();
    return;
  }

  saveName(name);

  const room = generateRoom();

  enterRoom(room, name);
});


/* =========================================================
   ENTRAR NA SALA
========================================================= */

joinBtn?.addEventListener("click", () => {
  const name = nameHome?.value.trim();

  const room = roomInput?.value
    .trim()
    .toUpperCase();

  if (!name) {
    toast("Digite seu nome primeiro.");
    nameHome?.focus();
    return;
  }

  if (!room) {
    toast("Digite o código da sala.");
    roomInput?.focus();
    return;
  }

  saveName(name);

  enterRoom(room, name);
});


roomInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinBtn?.click();
  }
});


nameHome?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    createBtn?.click();
  }
});


/* =========================================================
   SALVAR NOME
========================================================= */

function saveName(name) {
  try {
    localStorage.setItem(
      "hype_name",
      name
    );
  } catch {}
}


nameHome?.addEventListener("change", () => {
  const name = nameHome.value.trim();

  if (name) {
    saveName(name);
  }
});


/* =========================================================
   ENTRAR NA SALA
========================================================= */

function enterRoom(room, name) {
  roomId = room
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);

  myName = name
    .slice(0, 30);

  if (!roomId) {
    toast("Código de sala inválido.");
    return;
  }

  updateUrl(roomId);

  home?.classList.add("hidden");
  roomPage?.classList.remove("hidden");

  if (roomCodeEl) {
    roomCodeEl.textContent = roomId;
  }

  if (roomStatus) {
    roomStatus.textContent = "Conectando...";
  }

  /*
   * IMPORTANTE:
   * limpamos a lista antes de entrar.
   */
  participants.clear();

  renderParticipants();

  connectSocket();
}


/* =========================================================
   WEBSOCKET URL
========================================================= */

function websocketUrl() {
  const protocol =
    window.location.protocol === "https:"
      ? "wss:"
      : "ws:";

  return (
    protocol +
    "//" +
    window.location.host
  );
}


/* =========================================================
   CONECTAR WEBSOCKET
========================================================= */

function connectSocket() {
  if (
    socket &&
    (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  if (roomStatus) {
    roomStatus.textContent = "Conectando...";
  }

  try {
    socket = new WebSocket(
      websocketUrl()
    );
  } catch (error) {
    console.error(error);

    if (roomStatus) {
      roomStatus.textContent =
        "Erro de conexão";
    }

    scheduleReconnect();

    return;
  }


  socket.addEventListener("open", () => {
    reconnectState.attempts = 0;

    if (roomStatus) {
      roomStatus.textContent =
        "Conectado";
    }

    /*
     * ENVIA O JOIN PARA O SERVIDOR
     */
    send({
      type: "join",
      room: roomId,
      name: myName,
      mobile: isMobile
    });
  });


  socket.addEventListener("message", async (event) => {
    let message;

    try {
      message =
        JSON.parse(event.data);
    } catch (error) {
      console.error(
        "Mensagem inválida:",
        event.data
      );

      return;
    }

    await handleMessage(message);
  });


  socket.addEventListener("close", () => {
    if (roomStatus) {
      roomStatus.textContent =
        "Desconectado";
    }

    scheduleReconnect();
  });


  socket.addEventListener("error", (error) => {
    console.error(
      "WebSocket:",
      error
    );

    if (roomStatus) {
      roomStatus.textContent =
        "Erro de conexão";
    }
  });
}


/* =========================================================
   RECONEXÃO
========================================================= */

function scheduleReconnect() {
  if (
    reconnectState.timer ||
    !roomId
  ) {
    return;
  }

  reconnectState.attempts++;

  const delay =
    Math.min(
      10000,
      1000 * reconnectState.attempts
    );

  reconnectState.timer =
    setTimeout(() => {
      reconnectState.timer = null;

      connectSocket();
    }, delay);
}


/* =========================================================
   ENVIAR
========================================================= */

function send(message) {
  if (
    !socket ||
    socket.readyState !== WebSocket.OPEN
  ) {
    return false;
  }

  try {
    socket.send(
      JSON.stringify(message)
    );

    return true;
  } catch (error) {
    console.error(
      "Erro ao enviar:",
      error
    );

    return false;
  }
}


/* =========================================================
   MENSAGENS
========================================================= */

async function handleMessage(msg) {
  if (!msg || !msg.type) {
    return;
  }

  switch (msg.type) {

    case "joined":
      await handleJoined(msg);
      break;


    case "participant-joined":
      handleParticipantJoined(msg);
      break;


    case "participant-left":
      handleParticipantLeft(msg);
      break;


    case "participant-updated":
      handleParticipantUpdated(msg);
      break;


    case "participants-refresh":
      handleParticipantsRefresh(msg);
      break;


    case "signal":
      await handleSignal(msg);
      break;


    case "chat":
      addChatMessage(msg);
      break;


    case "error":
      toast(
        msg.message ||
        "Ocorreu um erro."
      );
      break;


    case "kicked":
      toast(
        msg.message ||
        "Você foi removido da sala."
      );

      setTimeout(() => {
        leaveRoom();
      }, 1000);

      break;


    case "forced-mute":
      setLocalMute(
        Boolean(msg.muted)
      );
      break;


    case "force-stop-share":
      stopScreenShare(false);
      break;


    case "admin-promoted":
      isAdmin = true;

      updateAdminInterface();

      toast(
        "Você agora é o administrador da sala."
      );

      break;


    default:
      console.log(
        "Mensagem desconhecida:",
        msg
      );
  }
}


/* =========================================================
   JOINED
========================================================= */

async function handleJoined(msg) {
  /*
   * O servidor precisa mandar nosso peerId.
   */

  myPeerId =
    msg.peerId ||
    msg.id ||
    "";


  roomId =
    msg.room ||
    roomId;


  isAdmin =
    Boolean(
      msg.admin
    );


  if (roomCodeEl) {
    roomCodeEl.textContent =
      roomId;
  }


  /*
   * PRIMEIRO:
   * adicionamos nós mesmos.
   *
   * Isso corrige o problema de
   * "não aparece quem está na call".
   */

  const myself = {
    peerId: myPeerId,
    id: myPeerId,
    name: myName,
    mobile: isMobile,
    admin: isAdmin,
    muted: true,
    sharing: false
  };


  if (myPeerId) {
    participants.set(
      myPeerId,
      myself
    );
  }


  /*
   * Depois adicionamos os demais.
   */

  const list =
    Array.isArray(msg.participants)
      ? msg.participants
      : [];


  for (const participant of list) {
    if (!participant) {
      continue;
    }

    const peerId =
      participant.peerId ||
      participant.id;

    if (!peerId) {
      continue;
    }

    /*
     * Evita duplicar nós mesmos.
     */
    if (peerId === myPeerId) {
      continue;
    }

    participants.set(
      peerId,
      normalizeParticipant(
        participant
      )
    );
  }


  updateAdminInterface();

  renderParticipants();


  /*
   * Criar conexões com quem
   * já estava na sala.
   */

  for (const participant of participants.values()) {

    if (
      participant.peerId ===
      myPeerId
    ) {
      continue;
    }

    await createPeerConnection(
      participant.peerId,
      true
    );
  }


  if (isMobile) {
    toast(
      "Você está no modo espectador. No celular é possível assistir às transmissões."
    );
  }
}


/* =========================================================
   PARTICIPANTE ENTROU
========================================================= */

function handleParticipantJoined(msg) {
  const participant =
    msg.participant ||
    msg.user ||
    msg;


  const normalized =
    normalizeParticipant(
      participant
    );


  if (!normalized.peerId) {
    return;
  }


  if (
    normalized.peerId ===
    myPeerId
  ) {
    return;
  }


  participants.set(
    normalized.peerId,
    normalized
  );


  renderParticipants();


  toast(
    `${normalized.name} entrou na sala.`
  );


  /*
   * Quem já estava na sala
   * cria conexão com o novo usuário.
   *
   * O novo usuário também receberá
   * os participantes e criará as
   * conexões dele.
   */

  createPeerConnection(
    normalized.peerId,
    false
  );
}


/* =========================================================
   PARTICIPANTE SAIU
========================================================= */

function handleParticipantLeft(msg) {
  const peerId =
    msg.peerId ||
    msg.id ||
    msg.participant?.peerId;


  if (!peerId) {
    return;
  }


  const participant =
    participants.get(
      peerId
    );


  participants.delete(
    peerId
  );


  const pc =
    peers.get(
      peerId
    );


  if (pc) {
    try {
      pc.close();
    } catch {}

    peers.delete(
      peerId
    );
  }


  removeVideo(peerId);


  renderParticipants();


  if (participant) {
    toast(
      `${participant.name} saiu da sala.`
    );
  }
}


/* =========================================================
   PARTICIPANTE ATUALIZADO
========================================================= */

function handleParticipantUpdated(msg) {
  const participant =
    msg.participant ||
    msg.user ||
    msg;


  const normalized =
    normalizeParticipant(
      participant
    );


  if (!normalized.peerId) {
    return;
  }


  participants.set(
    normalized.peerId,
    normalized
  );


  renderParticipants();


  updateVideoName(
    normalized.peerId,
    normalized.name
  );
}


/* =========================================================
   REFRESH PARTICIPANTES
========================================================= */

function handleParticipantsRefresh(msg) {
  const list =
    Array.isArray(msg.participants)
      ? msg.participants
      : [];


  /*
   * Não apagamos nós mesmos.
   */

  const myself =
    participants.get(
      myPeerId
    );


  participants.clear();


  /*
   * Sempre adiciona nós mesmos.
   */

  if (myself && myPeerId) {
    participants.set(
      myPeerId,
      myself
    );
  } else if (myPeerId) {
    participants.set(
      myPeerId,
      {
        peerId: myPeerId,
        id: myPeerId,
        name: myName,
        mobile: isMobile,
        admin: isAdmin,
        muted: !micEnabled,
        sharing: false
      }
    );
  }


  for (const participant of list) {
    const normalized =
      normalizeParticipant(
        participant
      );


    if (!normalized.peerId) {
      continue;
    }


    if (
      normalized.peerId ===
      myPeerId
    ) {
      continue;
    }


    participants.set(
      normalized.peerId,
      normalized
    );
  }


  renderParticipants();
}


/* =========================================================
   NORMALIZAR PARTICIPANTE
========================================================= */

function normalizeParticipant(participant) {
  if (!participant) {
    return {
      peerId: "",
      id: "",
      name: "Convidado",
      mobile: false,
      admin: false,
      muted: true,
      sharing: false
    };
  }


  const peerId =
    participant.peerId ||
    participant.id ||
    participant.userId ||
    "";


  return {
    ...participant,

    peerId,

    id:
      participant.id ||
      peerId,

    name:
      participant.name ||
      participant.username ||
      "Convidado",

    mobile:
      Boolean(
        participant.mobile
      ),

    admin:
      Boolean(
        participant.admin
      ),

    muted:
      participant.muted !== undefined
        ? Boolean(participant.muted)
        : true,

    sharing:
      Boolean(
        participant.sharing
      )
  };
}


/* =========================================================
   RENDER PARTICIPANTES
========================================================= */

function renderParticipants() {
  if (!participantsEl) {
    return;
  }


  participantsEl.innerHTML = "";


  for (const participant of participants.values()) {

    const row =
      document.createElement("div");

    row.className =
      "participant";


    /*
     * Avatar
     */

    const avatar =
      document.createElement("div");

    avatar.className =
      "avatar";

    avatar.textContent =
      (
        participant.name ||
        "?"
      )
        .charAt(0)
        .toUpperCase();


    /*
     * Nome
     */

    const name =
      document.createElement("div");

    name.className =
      "pname";

    name.textContent =
      participant.name ||
      "Convidado";


    /*
     * ADM
     */

    if (participant.admin) {
      const badge =
        document.createElement("span");

      badge.className =
        "admin-badge";

      badge.textContent =
        "ADM";

      name.appendChild(
        badge
      );
    }


    /*
     * "VOCÊ"
     */

    if (
      participant.peerId ===
      myPeerId
    ) {
      const you =
        document.createElement("span");

      you.className =
        "you-badge";

      you.textContent =
        " VOCÊ";

      name.appendChild(
        you
      );
    }


    /*
     * Dispositivo
     */

    const device =
      document.createElement("span");

    device.className =
      "device-badge";

    device.textContent =
      participant.mobile
        ? "📱"
        : "💻";


    /*
     * Microfone
     */

    const mic =
      document.createElement("span");

    mic.className =
      "mic-status";

    mic.textContent =
      participant.muted
        ? "🔇"
        : "🎙️";


    if (participant.muted) {
      mic.classList.add(
        "muted"
      );
    }


    /*
     * Compartilhando
     */

    row.appendChild(
      avatar
    );

    row.appendChild(
      name
    );

    row.appendChild(
      device
    );

    row.appendChild(
      mic
    );


    if (participant.sharing) {
      const dot =
        document.createElement("span");

      dot.className =
        "sharing-dot";

      dot.title =
        "Compartilhando tela";

      row.appendChild(
        dot
      );
    }


    /*
     * BOTÕES DO ADMIN
     */

    if (
      isAdmin &&
      participant.peerId !== myPeerId
    ) {

      const actions =
        document.createElement("div");

      actions.className =
        "participant-actions";


      /*
       * MUTE
       */

      const mute =
        document.createElement("button");

      mute.className =
        "mini-btn";

      mute.type =
        "button";

      mute.title =
        participant.muted
          ? "Ativar microfone"
          : "Silenciar usuário";

      mute.textContent =
        participant.muted
          ? "🔊"
          : "🔇";


      mute.addEventListener(
        "click",
        (event) => {

          event.stopPropagation();

          adminMuteUser(
            participant.peerId,
            !participant.muted
          );
        }
      );


      /*
       * EXPULSAR
       */

      const kick =
        document.createElement("button");

      kick.className =
        "mini-btn kick-btn";

      kick.type =
        "button";

      kick.title =
        "Expulsar usuário";

      kick.textContent =
        "✕";


      kick.addEventListener(
        "click",
        (event) => {

          event.stopPropagation();

          adminKickUser(
            participant.peerId
          );
        }
      );


      actions.appendChild(
        mute
      );

      actions.appendChild(
        kick
      );

      row.appendChild(
        actions
      );
    }


    participantsEl.appendChild(
      row
    );
  }


  if (countEl) {
    countEl.textContent =
      String(
        participants.size
      );
  }
}


/* =========================================================
   ADMIN
========================================================= */

function updateAdminInterface() {
  if (!roomPage) {
    return;
  }


  if (isAdmin) {

    roomPage.classList.add(
      "admin-mode"
    );


    if (adminButton) {
      adminButton.style.display =
        "inline-flex";
    }

  } else {

    roomPage.classList.remove(
      "admin-mode"
    );


    if (adminButton) {
      adminButton.style.display =
        "none";
    }


    adminPanel?.classList.add(
      "hidden"
    );
  }


  /*
   * Atualiza a informação do
   * nosso próprio usuário.
   */

  if (myPeerId) {

    const myself =
      participants.get(
        myPeerId
      );


    if (myself) {

      myself.admin =
        isAdmin;

      myself.name =
        myName;

      myself.muted =
        !micEnabled;

      myself.mobile =
        isMobile;
    }
  }


  renderParticipants();
}


/* =========================================================
   MENU ADMIN
========================================================= */

window.toggleAdminPanel =
  function () {

    if (!isAdmin) {
      toast(
        "Somente o administrador pode abrir este menu."
      );

      return;
    }


    adminPanel?.classList.toggle(
      "hidden"
    );
  };


/* =========================================================
   ADMIN - MUTAR TODOS
========================================================= */

window.adminMuteAll =
  function () {

    if (!isAdmin) {
      return;
    }


    send({
      type:
        "admin-mute-all"
    });


    toast(
      "Microfones dos participantes foram silenciados."
    );
  };


/* =========================================================
   ADMIN - PARAR TRANSMISSÕES
========================================================= */

window.adminStopShares =
  function () {

    if (!isAdmin) {
      return;
    }


    send({
      type:
        "admin-stop-shares"
    });


    toast(
      "Encerrando transmissões..."
    );
  };


/* =========================================================
   ADMIN - COPIAR CONVITE
========================================================= */

window.adminCopyInvite =
  function () {
    copyInvite();
  };


/* =========================================================
   ADMIN - MUTAR USUÁRIO
========================================================= */

function adminMuteUser(peerId, muted) {
  if (!isAdmin) {
    return;
  }


  send({
    type:
      "admin-mute",

    peerId,

    muted
  });
}


/* =========================================================
   ADMIN - EXPULSAR
========================================================= */

function adminKickUser(peerId) {
  if (!isAdmin) {
    return;
  }


  const participant =
    participants.get(
      peerId
    );


  if (!participant) {
    return;
  }


  const confirmed =
    confirm(
      `Expulsar ${participant.name} da sala?`
    );


  if (!confirmed) {
    return;
  }


  send({
    type:
      "admin-kick",

    peerId
  });
}


/* =========================================================
   WEBRTC
========================================================= */

function createPeerConnection(
  peerId,
  initiator
) {

  if (!peerId) {
    return null;
  }


  if (
    peerId ===
    myPeerId
  ) {
    return null;
  }


  if (
    peers.has(peerId)
  ) {
    return peers.get(
      peerId
    );
  }


  const pc =
    new RTCPeerConnection({
      iceServers: [
        {
          urls:
            "stun:stun.l.google.com:19302"
        },
        {
          urls:
            "stun:stun1.l.google.com:19302"
        }
      ]
    });


  peers.set(
    peerId,
    pc
  );


  /*
   * MICROFONE
   */

  if (localMicStream) {

    for (
      const track
      of localMicStream.getTracks()
    ) {

      pc.addTrack(
        track,
        localMicStream
      );
    }
  }


  /*
   * TELA
   */

  if (localScreenStream) {

    for (
      const track
      of localScreenStream.getTracks()
    ) {

      pc.addTrack(
        track,
        localScreenStream
      );
    }
  }


  /*
   * ICE
   */

  pc.onicecandidate =
    (event) => {

      if (
        event.candidate
      ) {

        send({
          type:
            "signal",

          to:
            peerId,

          signal: {
            type:
              "candidate",

            candidate:
              event.candidate
          }
        });
      }
    };


  /*
   * TRACK
   */

  pc.ontrack =
    (event) => {

      const stream =
        event.streams?.[0];


      if (!stream) {
        return;
      }


      showRemoteVideo(
        peerId,
        stream
      );
    };


  /*
   * ESTADO
   */

  pc.onconnectionstatechange =
    () => {

      console.log(
        "WebRTC",
        peerId,
        pc.connectionState
      );


      if (
        pc.connectionState ===
        "failed"
      ) {

        try {
          pc.restartIce();
        } catch {}
      }


      if (
        pc.connectionState ===
        "closed"
      ) {

        removeVideo(
          peerId
        );
      }
    };


  /*
   * OFERTA
   */

  if (initiator) {
    makeOffer(
      peerId,
      pc
    );
  }


  return pc;
}


/* =========================================================
   OFERTA
========================================================= */

async function makeOffer(
  peerId,
  pc
) {

  if (!pc) {
    return;
  }


  try {

    const offer =
      await pc.createOffer();


    await pc.setLocalDescription(
      offer
    );


    send({
      type:
        "signal",

      to:
        peerId,

      signal: {
        type:
          "offer",

        sdp:
          pc.localDescription
      }
    });

  } catch (error) {

    console.error(
      "Erro ao criar oferta:",
      error
    );
  }
}


/* =========================================================
   SIGNAL
========================================================= */

async function handleSignal(msg) {
  const peerId =
    msg.from ||
    msg.peerId;


  if (!peerId) {
    return;
  }


  if (
    peerId ===
    myPeerId
  ) {
    return;
  }


  let pc =
    peers.get(
      peerId
    );


  if (!pc) {

    pc =
      createPeerConnection(
        peerId,
        false
      );
  }


  if (!pc) {
    return;
  }


  const signal =
    msg.signal;


  if (!signal) {
    return;
  }


  try {

    if (
      signal.type ===
      "offer"
    ) {

      await pc.setRemoteDescription(
        signal.sdp
      );


      const answer =
        await pc.createAnswer();


      await pc.setLocalDescription(
        answer
      );


      send({
        type:
          "signal",

        to:
          peerId,

        signal: {
          type:
            "answer",

          sdp:
            pc.localDescription
        }
      });
    }


    else if (
      signal.type ===
      "answer"
    ) {

      await pc.setRemoteDescription(
        signal.sdp
      );
    }


    else if (
      signal.type ===
      "candidate"
    ) {

      if (
        signal.candidate
      ) {

        try {

          await pc.addIceCandidate(
            signal.candidate
          );

        } catch (error) {

          console.warn(
            "ICE candidate:",
            error
          );
        }
      }
    }

  } catch (error) {

    console.error(
      "Erro WebRTC:",
      error
    );
  }
}


/* =========================================================
   VÍDEO REMOTO
========================================================= */

function showRemoteVideo(
  peerId,
  stream
) {

  if (!videos) {
    return;
  }


  let card =
    document.getElementById(
      `video-${peerId}`
    );


  if (!card) {

    card =
      document.createElement(
        "div"
      );

    card.className =
      "video-card";

    card.id =
      `video-${peerId}`;


    const video =
      document.createElement(
        "video"
      );

    video.autoplay =
      true;

    video.playsInline =
      true;

    video.controls =
      false;

    video.muted =
      false;

    video.volume =
      1;


    card.appendChild(
      video
    );


    const name =
      document.createElement(
        "div"
      );

    name.className =
      "video-name";


    const participant =
      participants.get(
        peerId
      );


    name.textContent =
      participant?.name ||
      "Participante";


    card.appendChild(
      name
    );


    videos.appendChild(
      card
    );


    video.srcObject =
      stream;


    video.play()
      .catch(() => {

        card.classList.add(
          "audio-locked"
        );
      });


    card.addEventListener(
      "click",
      () => {

        video.muted =
          false;

        video.volume =
          1;

        video.play()
          .catch(() => {});
      }
    );

  } else {

    const video =
      card.querySelector(
        "video"
      );


    if (
      video &&
      video.srcObject !==
      stream
    ) {

      video.srcObject =
        stream;
    }
  }


  emptyState?.classList.add(
    "hidden"
  );
}


/* =========================================================
   ATUALIZAR NOME DO VÍDEO
========================================================= */

function updateVideoName(
  peerId,
  name
) {

  const card =
    document.getElementById(
      `video-${peerId}`
    );


  if (!card) {
    return;
  }


  const nameEl =
    card.querySelector(
      ".video-name"
    );


  if (nameEl) {
    nameEl.textContent =
      name ||
      "Participante";
  }
}


/* =========================================================
   REMOVER VÍDEO
========================================================= */

function removeVideo(peerId) {
  const card =
    document.getElementById(
      `video-${peerId}`
    );


  if (card) {
    card.remove();
  }


  if (
    videos &&
    videos.children.length === 0
  ) {

    emptyState?.classList.remove(
      "hidden"
    );
  }
}


/* =========================================================
   COMPARTILHAR TELA
========================================================= */

async function startScreenShare() {

  if (isMobile) {

    toast(
      "No Android/iPhone você pode apenas assistir."
    );

    return;
  }


  if (localScreenStream) {

    toast(
      "Você já está compartilhando."
    );

    return;
  }


  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getDisplayMedia
  ) {

    toast(
      "Seu navegador não suporta compartilhamento de tela."
    );

    return;
  }


  try {

    const stream =
      await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: {
            ideal: 30,
            max: 60
          }
        },

        audio: true
      });


    localScreenStream =
      stream;


    const videoTrack =
      stream.getVideoTracks()[0];


    if (videoTrack) {

      videoTrack.addEventListener(
        "ended",
        () => {

          stopScreenShare(
            true
          );
        }
      );
    }


    /*
     * Adiciona tela aos peers
     */

    for (
      const [
        peerId,
        pc
      ] of peers
    ) {

      for (
        const track
        of stream.getTracks()
      ) {

        try {

          pc.addTrack(
            track,
            stream
          );

        } catch {}
      }


      /*
       * Renegociação
       */

      try {

        const offer =
          await pc.createOffer();


        await pc.setLocalDescription(
          offer
        );


        send({
          type:
            "signal",

          to:
            peerId,

          signal: {
            type:
              "offer",

            sdp:
              pc.localDescription
          }
        });

      } catch (error) {

        console.error(
          "Renegociação:",
          error
        );
      }
    }


    send({
      type:
        "sharing",

      value:
        true
    });


    updateMyParticipant({
      sharing: true
    });


    shareBtn?.classList.add(
      "hidden"
    );

    shareCenterBtn?.classList.add(
      "hidden"
    );

    stopShareBtn?.classList.remove(
      "hidden"
    );


    toast(
      "Transmissão iniciada."
    );

  } catch (error) {

    console.error(
      "Compartilhamento:",
      error
    );


    if (
      error.name ===
      "NotAllowedError"
    ) {

      toast(
        "Você cancelou o compartilhamento."
      );

    } else {

      toast(
        "Não foi possível compartilhar a tela."
      );
    }
  }
}


/* =========================================================
   PARAR TELA
========================================================= */

function stopScreenShare(
  notifyServer = true
) {

  if (localScreenStream) {

    for (
      const track
      of localScreenStream.getTracks()
    ) {

      try {
        track.stop();
      } catch {}
    }


    localScreenStream =
      null;
  }


  /*
   * Remove vídeo dos senders.
   */

  for (const pc of peers.values()) {

    const senders =
      pc.getSenders();


    for (const sender of senders) {

      const track =
        sender.track;


      if (
        track &&
        track.kind ===
        "video"
      ) {

        try {
          pc.removeTrack(
            sender
          );
        } catch {}
      }
    }
  }


  if (notifyServer) {

    send({
      type:
        "sharing",

      value:
        false
    });
  }


  updateMyParticipant({
    sharing: false
  });


  shareBtn?.classList.remove(
    "hidden"
  );

  shareCenterBtn?.classList.remove(
    "hidden"
  );

  stopShareBtn?.classList.add(
    "hidden"
  );


  toast(
    "Transmissão encerrada."
  );
}


/* =========================================================
   MICROFONE
========================================================= */

async function toggleMicrophone() {

  if (isMobile) {

    toast(
      "No celular o microfone está desativado."
    );

    return;
  }


  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ) {

    toast(
      "Seu navegador não permite acessar o microfone."
    );

    return;
  }


  try {

    /*
     * Primeiro acesso ao microfone.
     */

    if (!localMicStream) {

      localMicStream =
        await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false
        });


      micEnabled =
        true;


      /*
       * Adiciona áudio aos peers.
       */

      for (
        const [
          peerId,
          pc
        ] of peers
      ) {

        for (
          const track
          of localMicStream.getTracks()
        ) {

          try {

            pc.addTrack(
              track,
              localMicStream
            );

          } catch {}
        }


        try {

          const offer =
            await pc.createOffer();


          await pc.setLocalDescription(
            offer
          );


          send({
            type:
              "signal",

            to:
              peerId,

            signal: {
              type:
                "offer",

              sdp:
                pc.localDescription
            }
          });

        } catch (error) {

          console.error(
            "Renegociação do microfone:",
            error
          );
        }
      }

    } else {

      /*
       * Liga/desliga.
       */

      micEnabled =
        !micEnabled;


      for (
        const track
        of localMicStream.getAudioTracks()
      ) {

        track.enabled =
          micEnabled;
      }
    }


    updateMicButton();


    updateMyParticipant({
      muted:
        !micEnabled
    });


    send({
      type:
        "mic",

      muted:
        !micEnabled
    });

  } catch (error) {

    console.error(
      "Microfone:",
      error
    );


    if (
      error.name ===
      "NotAllowedError"
    ) {

      toast(
        "Permita o acesso ao microfone no navegador."
      );

    } else {

      toast(
        "Não foi possível acessar o microfone."
      );
    }
  }
}


/* =========================================================
   MICROFONE FORÇADO
========================================================= */

function setLocalMute(muted) {

  if (!localMicStream) {

    micEnabled =
      !muted;


    updateMicButton();

    updateMyParticipant({
      muted
    });

    return;
  }


  for (
    const track
    of localMicStream.getAudioTracks()
  ) {

    track.enabled =
      !muted;
  }


  micEnabled =
    !muted;


  updateMicButton();


  updateMyParticipant({
    muted
  });


  toast(
    muted
      ? "Seu microfone foi silenciado."
      : "Seu microfone foi ativado."
  );
}


/* =========================================================
   ATUALIZAR MEU PARTICIPANTE
========================================================= */

function updateMyParticipant(data) {

  if (!myPeerId) {
    return;
  }


  const current =
    participants.get(
      myPeerId
    );


  if (!current) {
    return;
  }


  Object.assign(
    current,
    data
  );


  participants.set(
    myPeerId,
    current
  );


  renderParticipants();
}


/* =========================================================
   BOTÃO MICROFONE
========================================================= */

function updateMicButton() {

  if (!micBtn) {
    return;
  }


  if (micEnabled) {

    micBtn.innerHTML =
      "<span>🎙️</span> Microfone ligado";

  } else {

    micBtn.innerHTML =
      "<span>🔇</span> Microfone desligado";
  }
}


/* =========================================================
   CHAT
========================================================= */

chatForm?.addEventListener(
  "submit",
  (event) => {

    event.preventDefault();


    const text =
      chatInput?.value.trim();


    if (!text) {
      return;
    }


    send({
      type:
        "chat",

      text
    });


    if (chatInput) {
      chatInput.value =
        "";
    }
  }
);


/* =========================================================
   CHAT MESSAGE
========================================================= */

function addChatMessage(message) {

  if (!chatMessages) {
    return;
  }


  const item =
    document.createElement(
      "div"
    );

  item.className =
    "message";


  const meta =
    document.createElement(
      "div"
    );

  meta.className =
    "meta";


  meta.textContent =
    message.from ||
    message.name ||
    "Convidado";


  const text =
    document.createElement(
      "div"
    );

  text.className =
    "text";


  text.textContent =
    message.text ||
    "";


  item.appendChild(
    meta
  );

  item.appendChild(
    text
  );


  chatMessages.appendChild(
    item
  );


  chatMessages.scrollTop =
    chatMessages.scrollHeight;
}


/* =========================================================
   CONVITE
========================================================= */

function getInviteUrl() {

  const url =
    new URL(
      window.location.href
    );


  url.searchParams.set(
    "room",
    roomId
  );


  return url.toString();
}


async function copyInvite() {

  const invite =
    getInviteUrl();


  try {

    if (
      navigator.clipboard &&
      window.isSecureContext
    ) {

      await navigator.clipboard.writeText(
        invite
      );

    } else {

      const textarea =
        document.createElement(
          "textarea"
        );


      textarea.value =
        invite;


      document.body.appendChild(
        textarea
      );


      textarea.select();


      document.execCommand(
        "copy"
      );


      textarea.remove();
    }


    toast(
      "Convite copiado!"
    );

  } catch (error) {

    console.error(
      error
    );

    toast(
      "Não foi possível copiar o convite."
    );
  }
}


copyBtn?.addEventListener(
  "click",
  copyInvite
);


inviteBtn?.addEventListener(
  "click",
  copyInvite
);


/* =========================================================
   SAIR
========================================================= */

leaveBtn?.addEventListener(
  "click",
  leaveRoom
);


function leaveRoom() {

  /*
   * Tela
   */

  if (localScreenStream) {

    for (
      const track
      of localScreenStream.getTracks()
    ) {

      try {
        track.stop();
      } catch {}
    }

    localScreenStream =
      null;
  }


  /*
   * Microfone
   */

  if (localMicStream) {

    for (
      const track
      of localMicStream.getTracks()
    ) {

      try {
        track.stop();
      } catch {}
    }

    localMicStream =
      null;
  }


  /*
   * Peers
   */

  for (const pc of peers.values()) {

    try {
      pc.close();
    } catch {}
  }


  peers.clear();


  /*
   * WebSocket
   */

  if (socket) {

    try {
      socket.close();
    } catch {}

    socket =
      null;
  }


  participants.clear();


  if (videos) {
    videos.innerHTML =
      "";
  }


  emptyState?.classList.remove(
    "hidden"
  );


  roomPage?.classList.add(
    "hidden"
  );

  home?.classList.remove(
    "hidden"
  );


  try {

    const url =
      new URL(
        window.location.href
      );


    url.searchParams.delete(
      "room"
    );


    history.replaceState(
      {},
      "",
      url
    );

  } catch {}


  roomId =
    "";

  myPeerId =
    "";

  isAdmin =
    false;

  micEnabled =
    false;


  updateMicButton();

  updateAdminInterface();
}


/* =========================================================
   BOTÕES
========================================================= */

shareBtn?.addEventListener(
  "click",
  startScreenShare
);


shareCenterBtn?.addEventListener(
  "click",
  startScreenShare
);


stopShareBtn?.addEventListener(
  "click",
  () => {
    stopScreenShare(true);
  }
);


micBtn?.addEventListener(
  "click",
  toggleMicrophone
);


/* =========================================================
   MOBILE
========================================================= */

function applyMobileRestrictions() {

  if (!isMobile) {
    return;
  }


  /*
   * Android/iPhone:
   * somente assistir.
   */

  shareBtn?.classList.add(
    "hidden"
  );

  shareCenterBtn?.classList.add(
    "hidden"
  );

  stopShareBtn?.classList.add(
    "hidden"
  );

  micBtn?.classList.add(
    "hidden"
  );
}


applyMobileRestrictions();


/* =========================================================
   QUANDO A PÁGINA ABRE
========================================================= */

window.addEventListener(
  "load",
  () => {

    const room =
      getRoomFromUrl();


    let savedName =
      "";


    try {

      savedName =
        localStorage.getItem(
          "hype_name"
        ) || "";

    } catch {}


    if (
      nameHome &&
      savedName
    ) {

      nameHome.value =
        savedName;
    }


    /*
     * Se houver sala na URL
     * e nome salvo, entra automaticamente.
     */

    if (
      room &&
      savedName
    ) {

      enterRoom(
        room,
        savedName
      );
    }
  }
);


/* =========================================================
   BEFORE UNLOAD
========================================================= */

window.addEventListener(
  "beforeunload",
  () => {

    try {

      if (localScreenStream) {

        for (
          const track
          of localScreenStream.getTracks()
        ) {

          track.stop();
        }
      }


      if (localMicStream) {

        for (
          const track
          of localMicStream.getTracks()
        ) {

          track.stop();
        }
      }


      if (socket) {
        socket.close();
      }

    } catch {}
  }
);


/* =========================================================
   DEBUG
========================================================= */

console.log(
  "Hype Roleplay app.js carregado."
);

console.log(
  "Modo:",
  isMobile
    ? "MOBILE - ESPECTADOR"
    : "PC - TRANSMISSOR"
);
```
