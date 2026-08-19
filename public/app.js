```javascript
/* =========================================================
   HYPE ROLEPLAY
   Compartilhamento de tela - WebRTC
   PC: transmite
   Android/iPhone: somente assiste
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

  saveName(name);

  const room = generateRoom();

  enterRoom(room, name);
});

/* =========================================================
   ENTRAR NA SALA
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

  saveName(name);

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
      message = JSON.parse(event.data);
    } catch {
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

  socket.addEventListener("error", () => {
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

  reconnectState.timer =
    setTimeout(() => {
      reconnectState.timer = null;

      connectSocket();
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

  socket.send(
    JSON.stringify(message)
  );

  return true;
}

/* =========================================================
   MENSAGENS
========================================================= */

async function handleMessage(msg) {
  switch (msg.type) {

    case "joined":
      await handleJoined(msg);
      break;

    case "participant-joined":
      addParticipant(msg.participant);

      if (
        msg.participant &&
        msg.participant.peerId !== myPeerId
      ) {
        await createPeerConnection(
          msg.participant.peerId,
          true
        );
      }
      break;

    case "participant-left":
      removeParticipant(msg.peerId);
      break;

    case "participant-updated":
      updateParticipant(msg.participant);
      break;

    case "participants-refresh":
      refreshParticipants(
        msg.participants || []
      );
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
  }
}

/* =========================================================
   JOINED
========================================================= */

async function handleJoined(msg) {
  myPeerId = msg.peerId;

  isAdmin = Boolean(msg.admin);

  roomId = msg.room || roomId;

  if (roomCodeEl) {
    roomCodeEl.textContent = roomId;
  }

  refreshParticipants(
    msg.participants || []
  );

  updateAdminInterface();

  /*
   * Criar conexões com quem já estava na sala.
   */

  for (
    const participant of (
      msg.participants || []
    )
  ) {

    if (
      participant.peerId === myPeerId
    ) {
      continue;
    }

    addParticipant(participant);

    await createPeerConnection(
      participant.peerId,
      true
    );
  }

  if (isMobile) {
    toast(
      "Modo espectador: você pode assistir às transmissões."
    );
  }
}

/* =========================================================
   PARTICIPANTES
========================================================= */

function refreshParticipants(list) {
  participants.clear();

  for (
    const participant of list
  ) {
    if (!participant?.peerId) {
      continue;
    }

    participants.set(
      participant.peerId,
      participant
    );
  }

  renderParticipants();
}

function addParticipant(participant) {
  if (!participant?.peerId) {
    return;
  }

  participants.set(
    participant.peerId,
    participant
  );

  renderParticipants();
}

function updateParticipant(participant) {
  if (!participant?.peerId) {
    return;
  }

  participants.set(
    participant.peerId,
    participant
  );

  renderParticipants();

  updateVideoNames();
}

function removeParticipant(peerId) {
  participants.delete(peerId);

  const peer = peers.get(peerId);

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
   PARTICIPANTES - INTERFACE
========================================================= */

function renderParticipants() {
  if (!participantsEl) {
    return;
  }

  participantsEl.innerHTML = "";

  for (
    const participant of participants.values()
  ) {

    const row =
      document.createElement("div");

    row.className =
      "participant";

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

    const name =
      document.createElement("div");

    name.className =
      "pname";

    name.textContent =
      participant.name ||
      "Convidado";

    if (participant.admin) {
      const badge =
        document.createElement("span");

      badge.className =
        "admin-badge";

      badge.textContent =
        "ADM";

      name.appendChild(badge);
    }

    const device =
      document.createElement("span");

    device.className =
      "device-badge";

    device.textContent =
      participant.mobile
        ? "📱"
        : "💻";

    const mic =
      document.createElement("span");

    mic.className =
      "mic-status";

    mic.textContent =
      participant.muted
        ? "🔇"
        : "🎙️";

    if (participant.muted) {
      mic.classList.add("muted");
    }

    row.appendChild(avatar);
    row.appendChild(name);
    row.appendChild(device);
    row.appendChild(mic);

    if (participant.sharing) {
      const dot =
        document.createElement("span");

      dot.className =
        "sharing-dot";

      row.appendChild(dot);
    }

    /*
     * CONTROLES DO ADMIN
     */

    if (
      isAdmin &&
      participant.peerId !== myPeerId
    ) {

      const actions =
        document.createElement("div");

      actions.className =
        "participant-actions";

      const mute =
        document.createElement("button");

      mute.className =
        "mini-btn";

      mute.type =
        "button";

      mute.title =
        "Mutar usuário";

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

      actions.appendChild(mute);
      actions.appendChild(kick);

      row.appendChild(actions);
    }

    participantsEl.appendChild(row);
  }

  if (countEl) {
    countEl.textContent =
      String(participants.size);
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

  renderParticipants();
}

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

window.adminMuteAll =
  function () {

    if (!isAdmin) {
      return;
    }

    send({
      type: "admin-mute-all"
    });

    toast(
      "Microfones silenciados."
    );
  };

window.adminStopShares =
  function () {

    if (!isAdmin) {
      return;
    }

    send({
      type: "admin-stop-shares"
    });

    toast(
      "Encerrando transmissões..."
    );
  };

window.adminCopyInvite =
  function () {
    copyInvite();
  };

function adminMuteUser(peerId, muted) {
  if (!isAdmin) {
    return;
  }

  send({
    type: "admin-mute",
    peerId,
    muted
  });
}

function adminKickUser(peerId) {
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
      `Expulsar ${participant.name} da sala?`
    );

  if (!confirmed) {
    return;
  }

  send({
    type: "admin-kick",
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

  if (peers.has(peerId)) {
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

  peers.set(peerId, pc);

  /*
   * MICROFONE
   */

  if (localMicStream) {

    for (
      const track of
      localMicStream.getTracks()
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
      const track of
      localScreenStream.getTracks()
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

      if (!event.candidate) {
        return;
      }

      send({
        type: "signal",

        to: peerId,

        signal: {
          type: "candidate",
          candidate:
            event.candidate
        }
      });
    };

  /*
   * RECEBER STREAM
   */

  pc.ontrack =
    (event) => {

      let stream =
        event.streams?.[0];

      /*
       * Alguns navegadores podem não
       * enviar streams no evento.
       */

      if (!stream) {

        stream =
          new MediaStream();

        stream.addTrack(
          event.track
        );
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

        removeVideo(peerId);
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

  try {

    const offer =
      await pc.createOffer();

    await pc.setLocalDescription(
      offer
    );

    send({
      type: "signal",

      to: peerId,

      signal: {
        type: "offer",
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

    /*
     * OFERTA
     */

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
        type: "signal",

        to: peerId,

        signal: {
          type: "answer",

          sdp:
            pc.localDescription
        }
      });
    }

    /*
     * RESPOSTA
     */

    else if (
      signal.type ===
      "answer"
    ) {

      await pc.setRemoteDescription(
        signal.sdp
      );
    }

    /*
     * ICE
     */

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
            "ICE:",
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
   MINHA PRÓPRIA TELA
========================================================= */

function showLocalScreen(stream) {

  if (!videos) {
    return;
  }

  let card =
    document.getElementById(
      "local-screen-card"
    );

  if (!card) {

    card =
      document.createElement("div");

    card.className =
      "video-card local-screen-card";

    card.id =
      "local-screen-card";

    const video =
      document.createElement("video");

    video.autoplay =
      true;

    video.playsInline =
      true;

    video.muted =
      true;

    video.controls =
      false;

    const name =
      document.createElement("div");

    name.className =
      "video-name";

    name.textContent =
      `${myName} (você)`;

    card.appendChild(video);
    card.appendChild(name);

    videos.appendChild(card);

    emptyState?.classList.add(
      "hidden"
    );
  }

  const video =
    card.querySelector("video");

  if (video) {

    video.srcObject =
      stream;

    video.muted =
      true;

    video.play()
      .catch(() => {});
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

    const name =
      document.createElement("div");

    name.className =
      "video-name";

    const participant =
      participants.get(peerId);

    name.textContent =
      participant?.name ||
      "Participante";

    card.appendChild(video);
    card.appendChild(name);

    videos.appendChild(card);

    video.srcObject =
      stream;

    video.play()
      .catch(() => {

        card.classList.add(
          "audio-locked"
        );
      });

    /*
     * Clique ativa áudio.
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
      card.querySelector("video");

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
   ATUALIZAR NOMES DOS VÍDEOS
========================================================= */

function updateVideoNames() {

  for (
    const participant
    of participants.values()
  ) {

    const card =
      document.getElementById(
        `video-${participant.peerId}`
      );

    if (!card) {
      continue;
    }

    const name =
      card.querySelector(
        ".video-name"
      );

    if (name) {

      name.textContent =
        participant.name ||
        "Participante";
    }
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

  checkEmptyVideos();
}

function checkEmptyVideos() {

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

  /*
   * CELULAR NÃO TRANSMITE
   */

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

    /*
     * MOSTRAR A PRÓPRIA TELA
     */

    showLocalScreen(stream);

    /*
     * QUANDO PARAR PELO NAVEGADOR
     */

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
     * ENVIAR PARA OS PARTICIPANTES
     */

    for (
      const [
        peerId,
        pc
      ] of peers
    ) {

      /*
       * Adiciona as tracks.
       */

      for (
        const track
        of stream.getTracks()
      ) {

        pc.addTrack(
          track,
          stream
        );
      }

      /*
       * RENEGOCIAÇÃO
       */

      try {

        const offer =
          await pc.createOffer();

        await pc.setLocalDescription(
          offer
        );

        send({
          type: "signal",

          to: peerId,

          signal: {
            type: "offer",

            sdp:
              pc.localDescription
          }
        });

      } catch (error) {

        console.error(
          "Erro na renegociação:",
          error
        );
      }
    }

    /*
     * AVISAR SERVIDOR
     */

    send({
      type: "sharing",
      value: true
    });

    /*
     * BOTÕES
     */

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
   PARAR COMPARTILHAMENTO
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
   * REMOVER VÍDEO LOCAL
   */

  const localCard =
    document.getElementById(
      "local-screen-card"
    );

  if (localCard) {
    localCard.remove();
  }

  /*
   * REMOVER TRACK DE VÍDEO
   */

  for (
    const pc of peers.values()
  ) {

    const senders =
      pc.getSenders();

    for (
      const sender of senders
    ) {

      const track =
        sender.track;

      if (
        track &&
        track.kind === "video"
      ) {

        try {
          pc.removeTrack(sender);
        } catch {}
      }
    }
  }

  /*
   * AVISAR SERVIDOR
   */

  if (notifyServer) {

    send({
      type: "sharing",
      value: false
    });
  }

  /*
   * BOTÕES
   */

  shareBtn?.classList.remove(
    "hidden"
  );

  shareCenterBtn?.classList.remove(
    "hidden"
  );

  stopShareBtn?.classList.add(
    "hidden"
  );

  checkEmptyVideos();

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
          audio: true,
          video: false
        });

      micEnabled = true;

      /*
       * ADICIONAR AOS PEERS
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

          pc.addTrack(
            track,
            localMicStream
          );
        }

        try {

          const offer =
            await pc.createOffer();

          await pc.setLocalDescription(
            offer
          );

          send({
            type: "signal",

            to: peerId,

            signal: {
              type: "offer",

              sdp:
                pc.localDescription
            }
          });

        } catch {}
      }

    } else {

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

    send({
      type: "mic",
      muted: !micEnabled
    });

  } catch (error) {

    console.error(
      "Microfone:",
      error
    );

    toast(
      "Não foi possível acessar o microfone."
    );
  }
}

/* =========================================================
   MUTE LOCAL
========================================================= */

function setLocalMute(muted) {

  if (!localMicStream) {

    micEnabled =
      !muted;

    updateMicButton();

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
      chatInput.value.trim();

    if (!text) {
      return;
    }

    send({
      type: "chat",
      text
    });

    chatInput.value = "";
  }
);

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
    "Convidado";

  const text =
    document.createElement("div");

  text.className =
    "text";

  text.textContent =
    message.text || "";

  item.appendChild(meta);
  item.appendChild(text);

  chatMessages.appendChild(item);

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

  stopScreenShare(false);

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

  for (
    const pc of peers.values()
  ) {

    try {
      pc.close();
    } catch {}
  }

  peers.clear();

  if (socket) {

    try {
      socket.close();
    } catch {}

    socket = null;
  }

  participants.clear();

  if (videos) {
    videos.innerHTML = "";
  }

  roomPage?.classList.add(
    "hidden"
  );

  home?.classList.remove(
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

  roomId = "";
  myPeerId = "";
  isAdmin = false;
  micEnabled = false;

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
   CARREGAR SALA PELA URL
========================================================= */

window.addEventListener(
  "load",
  () => {

    const room =
      getRoomFromUrl();

    if (!room) {
      return;
    }

    let savedName = "";

    try {
      savedName =
        localStorage.getItem(
          "hype_name"
        ) || "";
    } catch {}

    if (savedName && nameHome) {

      nameHome.value =
        savedName;
    }

    if (savedName) {

      enterRoom(
        room,
        savedName
      );
    }
  }
);

/* =========================================================
   SALVAR NOME
========================================================= */

nameHome?.addEventListener(
  "change",
  () => {

    const name =
      nameHome.value.trim();

    if (name) {
      saveName(name);
    }
  }
);

/* =========================================================
   MOBILE
========================================================= */

function setupMobile() {

  if (!isMobile) {
    return;
  }

  /*
   * Celular somente assiste.
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

setupMobile();

/* =========================================================
   BEFORE UNLOAD
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
   FIM
========================================================= */
```

