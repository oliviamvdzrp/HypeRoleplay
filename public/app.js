/* =========================================================
   HYPE ROLEPLAY
   COMPARTILHAMENTO DE TELA - WEBRTC
   APP.JS COMPLETO
========================================================= */

const $ = (id) => document.getElementById(id);

/* =========================================================
   ELEMENTOS
========================================================= */

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
    console.log(message);
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
  const url = new URL(window.location.href);

  return (
    url.searchParams.get("room") || ""
  ).trim();
}

function updateUrl(room) {
  const url = new URL(window.location.href);

  url.searchParams.set("room", room);

  history.replaceState({}, "", url);
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
      Math.floor(Math.random() * chars.length)
    ];
  }

  return result;
}

/* =========================================================
   CRIAR SALA
========================================================= */

createBtn?.addEventListener("click", () => {
  const name = nameHome.value.trim();

  if (!name) {
    toast("Digite seu nome primeiro.");
    nameHome.focus();
    return;
  }

  saveName();

  const room = generateRoom();

  enterRoom(room, name);
});

/* =========================================================
   ENTRAR
========================================================= */

joinBtn?.addEventListener("click", () => {
  const name = nameHome.value.trim();

  const room = roomInput.value
    .trim()
    .toUpperCase();

  if (!name) {
    toast("Digite seu nome primeiro.");
    nameHome.focus();
    return;
  }

  if (!room) {
    toast("Digite o código da sala.");
    roomInput.focus();
    return;
  }

  saveName();

  enterRoom(room, name);
});

/* =========================================================
   ENTER
========================================================= */

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
   ENTRAR NA SALA
========================================================= */

function enterRoom(room, name) {
  roomId = room
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);

  myName = name
    .trim()
    .slice(0, 30);

  if (!roomId) {
    toast("Código de sala inválido.");
    return;
  }

  if (!myName) {
    toast("Nome inválido.");
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
   * Mostra imediatamente o próprio usuário.
   * Isso corrige o problema de "não aparecer que eu estou na call".
   */

  addLocalParticipant();

  connectSocket();
}

/* =========================================================
   ADICIONAR EU MESMO NA LISTA
========================================================= */

function addLocalParticipant() {
  if (!myName) {
    return;
  }

  /*
   * Enquanto o servidor ainda não forneceu o peerId,
   * usamos "me" temporariamente.
   */

  const localParticipant = {
    peerId: myPeerId || "me",
    name: myName,
    admin: isAdmin,
    mobile: isMobile,
    muted: !micEnabled,
    sharing: Boolean(localScreenStream)
  };

  participants.set(
    localParticipant.peerId,
    localParticipant
  );

  renderParticipants();
}

/* =========================================================
   ATUALIZAR MEU PARTICIPANTE
========================================================= */

function updateLocalParticipant() {
  const localKey = myPeerId || "me";

  const current = participants.get(localKey) || {};

  participants.set(localKey, {
    ...current,
    peerId: localKey,
    name: myName,
    admin: isAdmin,
    mobile: isMobile,
    muted: !micEnabled,
    sharing: Boolean(localScreenStream)
  });

  renderParticipants();
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
   CONECTAR SOCKET
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

  socket = new WebSocket(
    websocketUrl()
  );

  socket.addEventListener("open", () => {
    reconnectState.attempts = 0;

    if (roomStatus) {
      roomStatus.textContent = "Conectado";
    }

    /*
     * IMPORTANTE:
     * O servidor precisa receber o join.
     */

    send({
      type: "join",
      room: roomId,
      name: myName,
      mobile: isMobile
    });

    /*
     * Mostra novamente o próprio usuário
     * enquanto esperamos a resposta do servidor.
     */

    addLocalParticipant();
  });

  socket.addEventListener("message", async (event) => {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.error(
        "Mensagem WebSocket inválida:",
        error
      );

      return;
    }

    await handleMessage(message);
  });

  socket.addEventListener("close", () => {
    if (roomStatus) {
      roomStatus.textContent = "Desconectado";
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
  if (reconnectState.timer) {
    return;
  }

  reconnectState.attempts++;

  const delay = Math.min(
    10000,
    1000 * reconnectState.attempts
  );

  reconnectState.timer = setTimeout(() => {
    reconnectState.timer = null;

    if (roomId) {
      connectSocket();
    }
  }, delay);
}

/* =========================================================
   SEND
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
      updateLocalParticipant();

      toast(
        "Você agora é o administrador da sala."
      );

      break;

    default:
      console.log(
        "Mensagem recebida:",
        msg
      );
  }
}

/* =========================================================
   JOINED
========================================================= */

async function handleJoined(msg) {
  /*
   * Guardamos o ID real fornecido pelo servidor.
   */

  if (msg.peerId) {
    const oldKey = myPeerId || "me";

    myPeerId = msg.peerId;

    /*
     * Remove a versão temporária "me".
     */

    if (
      oldKey !== myPeerId &&
      participants.has(oldKey)
    ) {
      participants.delete(oldKey);
    }
  }

  if (msg.room) {
    roomId = msg.room;
  }

  isAdmin = Boolean(msg.admin);

  if (roomCodeEl) {
    roomCodeEl.textContent = roomId;
  }

  /*
   * Primeiro limpa a lista.
   */

  participants.clear();

  /*
   * Adiciona todos que o servidor informou.
   */

  if (
    Array.isArray(msg.participants)
  ) {
    for (
      const participant
      of msg.participants
    ) {
      if (
        participant &&
        participant.peerId
      ) {
        participants.set(
          participant.peerId,
          participant
        );
      }
    }
  }

  /*
   * GARANTE que EU apareça.
   */

  participants.set(
    myPeerId,
    {
      peerId: myPeerId,
      name: myName,
      admin: isAdmin,
      mobile: isMobile,
      muted: !micEnabled,
      sharing: Boolean(localScreenStream)
    }
  );

  renderParticipants();
  updateAdminInterface();

  /*
   * Criar WebRTC com quem já estava na sala.
   */

  if (
    Array.isArray(msg.participants)
  ) {

    for (
      const participant
      of msg.participants
    ) {

      if (
        !participant ||
        !participant.peerId ||
        participant.peerId === myPeerId
      ) {
        continue;
      }

      addParticipant(participant);

      try {
        await createPeerConnection(
          participant.peerId,
          true
        );
      } catch (error) {
        console.error(
          "Erro criando peer:",
          error
        );
      }
    }
  }

  renderParticipants();

  if (isMobile) {
    toast(
      "Você entrou como espectador. No celular é possível apenas assistir."
    );
  } else {
    toast(
      "Você entrou na sala."
    );
  }
}

/* =========================================================
   PARTICIPANTE ENTROU
========================================================= */

function handleParticipantJoined(msg) {
  const participant =
    msg.participant ||
    msg.user;

  if (
    !participant ||
    !participant.peerId
  ) {
    console.warn(
      "participant-joined sem participante:",
      msg
    );

    return;
  }

  addParticipant(participant);

  /*
   * Não criamos conexão aqui como iniciador
   * se o servidor já controla o fluxo.
   *
   * O novo usuário normalmente recebe os
   * participantes existentes no joined.
   */

  if (
    participant.peerId !== myPeerId
  ) {
    toast(
      `${participant.name || "Alguém"} entrou na sala.`
    );
  }
}

/* =========================================================
   PARTICIPANTE SAIU
========================================================= */

function handleParticipantLeft(msg) {
  const peerId =
    msg.peerId ||
    msg.id;

  if (!peerId) {
    return;
  }

  const participant =
    participants.get(peerId);

  removeParticipant(peerId);

  if (participant) {
    toast(
      `${participant.name || "Usuário"} saiu da sala.`
    );
  }
}

/* =========================================================
   PARTICIPANTE ATUALIZADO
========================================================= */

function handleParticipantUpdated(msg) {
  const participant =
    msg.participant ||
    msg.user;

  if (
    !participant ||
    !participant.peerId
  ) {
    return;
  }

  updateParticipant(
    participant
  );
}

/* =========================================================
   PARTICIPANTES REFRESH
========================================================= */

function handleParticipantsRefresh(msg) {
  const list =
    Array.isArray(msg.participants)
      ? msg.participants
      : [];

  refreshParticipants(list);

  /*
   * Garante que eu continue aparecendo.
   */

  updateLocalParticipant();
}

/* =========================================================
   PARTICIPANTES
========================================================= */

function refreshParticipants(list) {
  participants.clear();

  for (
    const participant
    of list
  ) {
    if (
      participant &&
      participant.peerId
    ) {
      participants.set(
        participant.peerId,
        participant
      );
    }
  }

  /*
   * Nunca deixar o próprio usuário desaparecer.
   */

  if (myName) {
    participants.set(
      myPeerId || "me",
      {
        peerId: myPeerId || "me",
        name: myName,
        admin: isAdmin,
        mobile: isMobile,
        muted: !micEnabled,
        sharing: Boolean(localScreenStream)
      }
    );
  }

  renderParticipants();
}

function addParticipant(participant) {
  if (
    !participant ||
    !participant.peerId
  ) {
    return;
  }

  participants.set(
    participant.peerId,
    participant
  );

  renderParticipants();
}

function updateParticipant(participant) {
  if (
    !participant ||
    !participant.peerId
  ) {
    return;
  }

  participants.set(
    participant.peerId,
    participant
  );

  renderParticipants();
}

function removeParticipant(peerId) {
  if (!peerId) {
    return;
  }

  participants.delete(
    peerId
  );

  const peer =
    peers.get(peerId);

  if (peer) {
    try {
      peer.close();
    } catch {}

    peers.delete(peerId);
  }

  removeVideo(peerId);

  renderParticipants();
}

/* =========================================================
   RENDER PARTICIPANTES
========================================================= */

function renderParticipants() {
  if (!participantsEl) {
    return;
  }

  participantsEl.innerHTML = "";

  /*
   * Ordena colocando ADM primeiro
   * e depois os demais.
   */

  const list =
    Array.from(
      participants.values()
    ).sort((a, b) => {
      if (a.admin && !b.admin) {
        return -1;
      }

      if (!a.admin && b.admin) {
        return 1;
      }

      return (
        (a.name || "").localeCompare(
          b.name || ""
        )
      );
    });

  for (
    const participant
    of list
  ) {

    const row =
      document.createElement("div");

    row.className =
      "participant";

    if (
      participant.peerId === myPeerId ||
      participant.peerId === "me"
    ) {
      row.classList.add(
        "me"
      );
    }

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
     * Meu nome
     */

    if (
      participant.peerId === myPeerId ||
      participant.peerId === "me"
    ) {

      const you =
        document.createElement("span");

      you.className =
        "you-badge";

      you.textContent =
        "Você";

      name.appendChild(
        you
      );
    }

    /*
     * ADM
     */

    if (
      participant.admin
    ) {

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

    if (
      participant.muted
    ) {
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

    if (
      participant.sharing
    ) {

      const dot =
        document.createElement("span");

      dot.className =
        "sharing-dot";

      row.appendChild(
        dot
      );
    }

    /*
     * AÇÕES ADM
     */

    if (
      isAdmin &&
      participant.peerId !== myPeerId &&
      participant.peerId !== "me"
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
          : "Mutar usuário";

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
   ADMIN INTERFACE
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
   MUTAR TODOS
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
      "Silenciando participantes..."
    );
  };

/* =========================================================
   PARAR TODAS AS TRANSMISSÕES
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
   COPIAR CONVITE
========================================================= */

window.adminCopyInvite =
  function () {
    copyInvite();
  };

/* =========================================================
   ADM - MUTE
========================================================= */

function adminMuteUser(
  peerId,
  muted
) {

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
   ADM - KICK
========================================================= */

function adminKickUser(
  peerId
) {

  if (!isAdmin) {
    return;
  }

  const participant =
    participants.get(peerId);

  if (!participant) {
    return;
  }

  const confirmed =
    confirm(
      `Expulsar ${participant.name || "usuário"} da sala?`
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

  if (
    peers.has(peerId)
  ) {
    return peers.get(peerId);
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

      try {

        pc.addTrack(
          track,
          localMicStream
        );

      } catch (error) {

        console.error(
          "Erro adicionando microfone:",
          error
        );

      }
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

      try {

        pc.addTrack(
          track,
          localScreenStream
        );

      } catch (error) {

        console.error(
          "Erro adicionando tela:",
          error
        );

      }
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

      let stream =
        event.streams &&
        event.streams[0];

      /*
       * Alguns navegadores podem não
       * entregar streams no evento.
       */

      if (!stream) {

        stream =
          new MediaStream([
            event.track
          ]);
      }

      showRemoteVideo(
        peerId,
        stream
      );
    };

  /*
   * CONEXÃO
   */

  pc.onconnectionstatechange =
    () => {

      console.log(
        "Peer",
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

      if (
        pc.connectionState ===
        "disconnected"
      ) {

        setTimeout(() => {

          if (
            pc.connectionState ===
            "disconnected"
          ) {

            removeVideo(
              peerId
            );
          }

        }, 5000);
      }
    };

  /*
   * NEGOCIAÇÃO
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
   OFFER
========================================================= */

async function makeOffer(
  peerId,
  pc
) {

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
    msg.from;

  if (!peerId) {
    return;
  }

  let pc =
    peers.get(peerId);

  if (!pc) {

    pc =
      createPeerConnection(
        peerId,
        false
      );
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
      document.createElement("div");

    card.className =
      "video-card";

    card.id =
      `video-${peerId}`;

    /*
     * VIDEO
     */

    const video =
      document.createElement("video");

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

    video.srcObject =
      stream;

    card.appendChild(
      video
    );

    /*
     * NOME
     */

    const name =
      document.createElement("div");

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

    /*
     * PLAY
     */

    video.play()
      .catch(() => {

        card.classList.add(
          "audio-locked"
        );
      });

    /*
     * Clique libera áudio
     */

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
      video.srcObject !== stream
    ) {

      video.srcObject =
        stream;

      video.play()
        .catch(() => {});
    }
  }

  emptyState?.classList.add(
    "hidden"
  );
}

/* =========================================================
   REMOVER VÍDEO
========================================================= */

function removeVideo(
  peerId
) {

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
     * Adiciona a tela aos peers.
     */

    for (
      const [
        peerId,
        pc
      ]
      of peers
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

        } catch (error) {

          console.error(
            "Erro adicionando tela:",
            error
          );
        }
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

    updateLocalParticipant();

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
   * Remove apenas tracks de vídeo.
   *
   * OBS:
   * A renegociação será feita quando
   * necessário.
   */

  for (
    const pc
    of peers.values()
  ) {

    const senders =
      pc.getSenders();

    for (
      const sender
      of senders
    ) {

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

  updateLocalParticipant();

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

  try {

    /*
     * PRIMEIRA VEZ
     */

    if (!localMicStream) {

      localMicStream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: false
        });

      micEnabled =
        true;

      /*
       * Adiciona microfone
       * aos peers.
       */

      for (
        const [
          peerId,
          pc
        ]
        of peers
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

    }

    /*
     * JÁ TEM MICROFONE
     */

    else {

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

    updateLocalParticipant();

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
   MUTE LOCAL
========================================================= */

function setLocalMute(
  muted
) {

  if (!localMicStream) {

    micEnabled =
      !muted;

    updateMicButton();
    updateLocalParticipant();

    toast(
      muted
        ? "Seu microfone foi silenciado."
        : "Seu microfone foi ativado."
    );

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
  updateLocalParticipant();

  toast(
    muted
      ? "Seu microfone foi silenciado."
      : "Seu microfone foi ativado."
  );
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

    chatInput.value =
      "";
  }
);

/* =========================================================
   ADICIONAR CHAT
========================================================= */

function addChatMessage(message) {

  if (!chatMessages) {
    return;
  }

  const item =
    document.createElement("div");

  item.className =
    "message";

  const meta =
    document.createElement("div");

  meta.className =
    "meta";

  meta.textContent =
    message.from ||
    message.name ||
    "Convidado";

  const text =
    document.createElement("div");

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

    await navigator.clipboard.writeText(
      invite
    );

    toast(
      "Convite copiado!"
    );

  } catch {

    const textarea =
      document.createElement("textarea");

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

    toast(
      "Convite copiado!"
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
   * Para compartilhamento
   */

  stopScreenShare(
    false
  );

  /*
   * Para microfone
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

  micEnabled =
    false;

  /*
   * Fecha peers
   */

  for (
    const pc
    of peers.values()
  ) {

    try {
      pc.close();
    } catch {}
  }

  peers.clear();

  /*
   * Fecha WebSocket
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

  home?.classList.remove(
    "hidden"
  );

  roomPage?.classList.add(
    "hidden"
  );

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

  roomId =
    "";

  myPeerId =
    "";

  myName =
    "";

  isAdmin =
    false;

  if (countEl) {
    countEl.textContent =
      "0";
  }

  updateAdminInterface();
  updateMicButton();
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
   SALVAR NOME
========================================================= */

function saveName() {

  const name =
    nameHome?.value.trim();

  if (name) {

    localStorage.setItem(
      "hype_name",
      name
    );
  }
}

nameHome?.addEventListener(
  "change",
  saveName
);

/* =========================================================
   CARREGAR PÁGINA
========================================================= */

window.addEventListener(
  "load",
  () => {

    const room =
      getRoomFromUrl();

    const savedName =
      localStorage.getItem(
        "hype_name"
      );

    if (savedName && nameHome) {
      nameHome.value =
        savedName;
    }

    if (
      room &&
      savedName
    ) {

      enterRoom(
        room,
        savedName
      );
    }

    /*
     * Configuração mobile
     */

    if (isMobile) {

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

    updateMicButton();
  }
);

/* =========================================================
   MOBILE
========================================================= */

if (isMobile) {

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

/* =========================================================
   ANTES DE FECHAR
========================================================= */

window.addEventListener(
  "beforeunload",
  () => {

    if (socket) {

      try {
        socket.close();
      } catch {}
    }
  }
);

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

updateMicButton();

console.log(
  "Hype Roleplay app.js carregado."
);
