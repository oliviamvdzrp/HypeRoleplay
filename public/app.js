```javascript
/* =========================================================
   HYPE ROLEPLAY
   COMPARTILHAMENTO DE TELA - WEBRTC
   VERSÃO CORRIGIDA
========================================================= */

const $ = id => document.getElementById(id);

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

/*
 * Stream da tela local.
 */
let localScreenStream = null;

/*
 * Stream do microfone local.
 */
let localMicStream = null;

/*
 * Microfone começa SEMPRE desligado.
 */
let micEnabled = false;

/*
 * Peer connections.
 */
const peers = new Map();

/*
 * Participantes.
 */
const participants = new Map();

/*
 * Streams remotos.
 *
 * Cada participante terá UMA única MediaStream.
 */
const remoteStreams = new Map();

/*
 * Evita adicionar duas vezes
 * o mesmo track.
 */
const remoteTracks = new Map();

/*
 * Reconexão.
 */
const reconnectState = {
  attempts: 0,
  timer: null
};

/* =========================================================
   MOBILE
========================================================= */

function detectMobile() {

  const ua =
    navigator.userAgent || "";

  return /Android|iPhone|iPad|iPod|Mobile/i.test(
    ua
  );
}

isMobile = detectMobile();

/* =========================================================
   TOAST
========================================================= */

let toastTimer = null;

function toast(message) {

  if (!toastEl) {

    console.log(message);

    return;
  }

  toastEl.textContent =
    message;

  toastEl.classList.add(
    "show"
  );

  clearTimeout(
    toastTimer
  );

  toastTimer =
    setTimeout(
      () => {

        toastEl.classList.remove(
          "show"
        );

      },
      3000
    );
}

/* =========================================================
   URL
========================================================= */

function getRoomFromUrl() {

  const url =
    new URL(
      window.location.href
    );

  return (
    url.searchParams.get(
      "room"
    ) || ""
  ).trim();
}

function updateUrl(room) {

  const url =
    new URL(
      window.location.href
    );

  url.searchParams.set(
    "room",
    room
  );

  history.replaceState(
    {},
    "",
    url
  );
}

/* =========================================================
   SALA
========================================================= */

function generateRoom() {

  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let result = "";

  for (
    let i = 0;
    i < 6;
    i++
  ) {

    result +=
      chars[
        Math.floor(
          Math.random() *
          chars.length
        )
      ];
  }

  return result;
}

/* =========================================================
   CRIAR SALA
========================================================= */

createBtn?.addEventListener(
  "click",
  () => {

    const name =
      nameHome.value.trim();

    if (!name) {

      toast(
        "Digite seu nome primeiro."
      );

      nameHome.focus();

      return;
    }

    localStorage.setItem(
      "hype_name",
      name
    );

    const room =
      generateRoom();

    enterRoom(
      room,
      name
    );
  }
);

/* =========================================================
   ENTRAR
========================================================= */

joinBtn?.addEventListener(
  "click",
  () => {

    const name =
      nameHome.value.trim();

    const room =
      roomInput.value
        .trim()
        .toUpperCase();

    if (!name) {

      toast(
        "Digite seu nome primeiro."
      );

      nameHome.focus();

      return;
    }

    if (!room) {

      toast(
        "Digite o código da sala."
      );

      roomInput.focus();

      return;
    }

    localStorage.setItem(
      "hype_name",
      name
    );

    enterRoom(
      room,
      name
    );
  }
);

/* =========================================================
   ENTER
========================================================= */

roomInput?.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Enter"
    ) {

      joinBtn?.click();

    }
  }
);

nameHome?.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Enter"
    ) {

      createBtn?.click();

    }
  }
);

/* =========================================================
   ENTRAR NA SALA
========================================================= */

function enterRoom(
  room,
  name
) {

  roomId =
    room
      .replace(
        /[^a-zA-Z0-9_-]/g,
        ""
      )
      .slice(
        0,
        32
      );

  myName =
    name
      .slice(
        0,
        30
      );

  if (!roomId) {

    toast(
      "Código de sala inválido."
    );

    return;
  }

  /*
   * Sempre começa mutado.
   */
  micEnabled =
    false;

  updateMicButton();

  updateUrl(
    roomId
  );

  home?.classList.add(
    "hidden"
  );

  roomPage?.classList.remove(
    "hidden"
  );

  if (roomCodeEl) {

    roomCodeEl.textContent =
      roomId;

  }

  if (roomStatus) {

    roomStatus.textContent =
      "Conectando...";

  }

  connectSocket();
}

/* =========================================================
   WEBSOCKET URL
========================================================= */

function websocketUrl() {

  const protocol =
    window.location.protocol ===
    "https:"
      ? "wss:"
      : "ws:";

  return (
    protocol +
    "//" +
    window.location.host
  );
}

/* =========================================================
   WEBSOCKET
========================================================= */

function connectSocket() {

  if (
    socket &&
    (
      socket.readyState ===
      WebSocket.OPEN ||

      socket.readyState ===
      WebSocket.CONNECTING
    )
  ) {

    return;
  }

  if (roomStatus) {

    roomStatus.textContent =
      "Conectando...";

  }

  socket =
    new WebSocket(
      websocketUrl()
    );

  socket.addEventListener(
    "open",
    () => {

      reconnectState.attempts =
        0;

      if (roomStatus) {

        roomStatus.textContent =
          "Conectado";

      }

      send({
        type:
          "join",

        room:
          roomId,

        name:
          myName,

        mobile:
          isMobile
      });

    }
  );

  socket.addEventListener(
    "message",
    event => {

      let message;

      try {

        message =
          JSON.parse(
            event.data
          );

      } catch {

        return;

      }

      handleMessage(
        message
      );

    }
  );

  socket.addEventListener(
    "close",
    () => {

      if (roomStatus) {

        roomStatus.textContent =
          "Desconectado";

      }

      scheduleReconnect();

    }
  );

  socket.addEventListener(
    "error",
    () => {

      if (roomStatus) {

        roomStatus.textContent =
          "Erro de conexão";

      }

    }
  );
}

/* =========================================================
   RECONEXÃO
========================================================= */

function scheduleReconnect() {

  if (
    reconnectState.timer
  ) {

    return;

  }

  reconnectState.attempts++;

  const delay =
    Math.min(
      10000,
      1000 *
      reconnectState.attempts
    );

  reconnectState.timer =
    setTimeout(
      () => {

        reconnectState.timer =
          null;

        connectSocket();

      },
      delay
    );
}

/* =========================================================
   SEND
========================================================= */

function send(message) {

  if (
    !socket ||
    socket.readyState !==
    WebSocket.OPEN
  ) {

    return false;

  }

  try {

    socket.send(
      JSON.stringify(
        message
      )
    );

    return true;

  } catch (error) {

    console.error(
      "Erro WebSocket:",
      error
    );

    return false;
  }
}

/* =========================================================
   MENSAGENS
========================================================= */

async function handleMessage(
  msg
) {

  switch (
    msg.type
  ) {

    case "joined":

      await handleJoined(
        msg
      );

      break;

    case "participant-joined":

      addParticipant(
        msg.participant
      );

      /*
       * O novo participante não inicia
       * conexão duplicada aqui.
       *
       * O usuário que já estava na sala
       * cria a conexão.
       */

      await createPeerConnection(
        msg.participant.peerId,
        true
      );

      break;

    case "participant-left":

      removeParticipant(
        msg.peerId
      );

      break;

    case "participant-updated":

      updateParticipant(
        msg.participant
      );

      break;

    case "participants-refresh":

      refreshParticipants(
        msg.participants
      );

      break;

    case "signal":

      await handleSignal(
        msg
      );

      break;

    case "chat":

      addChatMessage(
        msg
      );

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

      setTimeout(
        () => leaveRoom(),
        1000
      );

      break;

    case "forced-mute":

      setLocalMute(
        Boolean(
          msg.muted
        )
      );

      break;

    case "force-stop-share":

      stopScreenShare(
        false
      );

      break;

    case "admin-promoted":

      isAdmin =
        true;

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

async function handleJoined(
  msg
) {

  myPeerId =
    msg.peerId;

  isAdmin =
    Boolean(
      msg.admin
    );

  roomId =
    msg.room;

  if (roomCodeEl) {

    roomCodeEl.textContent =
      roomId;

  }

  /*
   * Começa mutado.
   */
  micEnabled =
    false;

  updateMicButton();

  refreshParticipants(
    msg.participants || []
  );

  updateAdminInterface();

  /*
   * Conecta somente com quem já estava
   * na sala.
   */

  for (
    const participant
    of (
      msg.participants || []
    )
  ) {

    if (
      participant.peerId ===
      myPeerId
    ) {

      continue;

    }

    addParticipant(
      participant
    );

    /*
     * Só o novo usuário cria a conexão.
     */
    await createPeerConnection(
      participant.peerId,
      true
    );
  }

  /*
   * Celular somente assiste.
   */

  if (isMobile) {

    hideMobileControls();

    toast(
      "Você entrou como espectador. No celular é possível assistir às transmissões."
    );

  }
}

/* =========================================================
   PARTICIPANTES
========================================================= */

function refreshParticipants(
  list
) {

  participants.clear();

  for (
    const participant
    of list
  ) {

    participants.set(
      participant.peerId,
      participant
    );
  }

  renderParticipants();
}

function addParticipant(
  participant
) {

  if (!participant) {
    return;
  }

  participants.set(
    participant.peerId,
    participant
  );

  renderParticipants();
}

function updateParticipant(
  participant
) {

  if (!participant) {
    return;
  }

  participants.set(
    participant.peerId,
    participant
  );

  /*
   * Atualiza o nome na tela sem recriar
   * a conexão WebRTC.
   */

  const card =
    document.getElementById(
      `video-${participant.peerId}`
    );

  if (card) {

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

  renderParticipants();
}

function removeParticipant(
  peerId
) {

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

  remoteStreams.delete(
    peerId
  );

  remoteTracks.delete(
    peerId
  );

  removeVideo(
    peerId
  );

  renderParticipants();
}

/* =========================================================
   PARTICIPANTES NA TELA
========================================================= */

function renderParticipants() {

  if (!participantsEl) {
    return;
  }

  participantsEl.innerHTML =
    "";

  for (
    const participant
    of participants.values()
  ) {

    const row =
      document.createElement(
        "div"
      );

    row.className =
      "participant";

    const avatar =
      document.createElement(
        "div"
      );

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
      document.createElement(
        "div"
      );

    name.className =
      "pname";

    name.textContent =
      participant.name ||
      "Convidado";

    if (
      participant.admin
    ) {

      const badge =
        document.createElement(
          "span"
        );

      badge.className =
        "admin-badge";

      badge.textContent =
        "ADM";

      name.appendChild(
        badge
      );
    }

    const device =
      document.createElement(
        "span"
      );

    device.className =
      "device-badge";

    device.textContent =
      participant.mobile
        ? "📱"
        : "💻";

    const mic =
      document.createElement(
        "span"
      );

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
        document.createElement(
          "span"
        );

      dot.className =
        "sharing-dot";

      row.appendChild(
        dot
      );
    }

    /*
     * Controles do administrador.
     */

    if (
      isAdmin &&
      participant.peerId !==
      myPeerId
    ) {

      const actions =
        document.createElement(
          "div"
        );

      actions.className =
        "participant-actions";

      const mute =
        document.createElement(
          "button"
        );

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
        event => {

          event.stopPropagation();

          adminMuteUser(
            participant.peerId,
            !participant.muted
          );

        }
      );

      const kick =
        document.createElement(
          "button"
        );

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
        event => {

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
      type:
        "admin-mute-all"
    });

    toast(
      "Todos os microfones foram silenciados."
    );
  };

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

window.adminCopyInvite =
  function () {

    copyInvite();

  };

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

function adminKickUser(
  peerId
) {

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

  if (
    peerId === myPeerId
  ) {

    return null;

  }

  if (
    peers.has(
      peerId
    )
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
   * NÃO adicionamos microfone automaticamente.
   *
   * Isso evita:
   * - retorno
   * - duplicação
   * - microfone aberto sem autorização.
   */

  if (
    localMicStream
  ) {

    for (
      const track
      of localMicStream.getAudioTracks()
    ) {

      track.enabled =
        micEnabled;

      pc.addTrack(
        track,
        localMicStream
      );

    }
  }

  /*
   * Adicionar tela se estiver compartilhando.
   */

  if (
    localScreenStream
  ) {

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
    event => {

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
   * RECEBER ÁUDIO/TELA.
   */

  pc.ontrack =
    event => {

      handleRemoteTrack(
        peerId,
        event
      );

    };

  /*
   * Estado.
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

        removeVideo(
          peerId
        );

      }
    };

  /*
   * Só o iniciador cria oferta.
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
   REMOTE TRACK
========================================================= */

function handleRemoteTrack(
  peerId,
  event
) {

  if (!event.track) {
    return;
  }

  let stream =
    remoteStreams.get(
      peerId
    );

  if (!stream) {

    stream =
      new MediaStream();

    remoteStreams.set(
      peerId,
      stream
    );
  }

  /*
   * Evita adicionar o mesmo track duas vezes.
   */

  let trackSet =
    remoteTracks.get(
      peerId
    );

  if (!trackSet) {

    trackSet =
      new Set();

    remoteTracks.set(
      peerId,
      trackSet
    );
  }

  if (
    trackSet.has(
      event.track.id
    )
  ) {

    return;

  }

  trackSet.add(
    event.track.id
  );

  stream.addTrack(
    event.track
  );

  /*
   * Uma única mídia para cada participante.
   */

  showRemoteMedia(
    peerId,
    stream
  );
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

async function handleSignal(
  msg
) {

  const peerId =
    msg.from;

  if (
    !peerId ||
    peerId === myPeerId
  ) {

    return;

  }

  let pc =
    peers.get(
      peerId
    );

  /*
   * Quem recebe uma oferta cria a conexão
   * mas NÃO cria outra oferta.
   */

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

      return;
    }

    if (
      signal.type ===
      "answer"
    ) {

      /*
       * Evita erro de estado.
       */

      if (
        pc.signalingState ===
        "have-local-offer"
      ) {

        await pc.setRemoteDescription(
          signal.sdp
        );

      }

      return;
    }

    if (
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
   MOSTRAR MÍDIA REMOTA
========================================================= */

function showRemoteMedia(
  peerId,
  stream
) {

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

    /*
     * IMPORTANTE:
     *
     * Não mutamos o vídeo remoto.
     *
     * Assim o usuário consegue ouvir
     * a outra pessoa.
     *
     * Porém nunca adicionamos nosso
     * próprio stream aqui.
     */

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

    /*
     * Botão de áudio.
     */

    const audioButton =
      document.createElement(
        "button"
      );

    audioButton.className =
      "remote-audio-button";

    audioButton.type =
      "button";

    audioButton.textContent =
      "🔊 Áudio";

    audioButton.addEventListener(
      "click",
      event => {

        event.stopPropagation();

        video.muted =
          false;

        video.volume =
          1;

        video.play()
          .catch(
            () => {}
          );

      }
    );

    card.appendChild(
      audioButton
    );

    videos.appendChild(
      card
    );

    video.srcObject =
      stream;

    video.play()
      .catch(
        () => {

          /*
           * Alguns navegadores bloqueiam
           * autoplay com áudio.
           */

          audioButton.classList.add(
            "show"
          );

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

    const video =
      card.querySelector(
        "video"
      );

    if (video) {

      video.srcObject =
        null;

    }

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

  if (
    localScreenStream
  ) {

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

            ideal:
              30,

            max:
              60

          }

        },

        /*
         * Áudio do sistema.
         */
        audio:
          true

      });

    localScreenStream =
      stream;

    /*
     * MOSTRAR A MINHA PRÓPRIA TELA.
     *
     * Isso é local e não vai para o servidor.
     */

    showLocalScreen(
      stream
    );

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
     * Enviar para cada participante.
     */

    for (
      const [
        peerId,
        pc
      ]
      of peers
    ) {

      if (!pc) {
        continue;
      }

      /*
       * Adiciona SOMENTE as tracks da tela.
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
       * Renegociação.
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
          "Erro renegociando tela:",
          error
        );

      }
    }

    /*
     * Avisar servidor.
     */

    send({

      type:
        "sharing",

      value:
        true

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
   MINHA TELA
========================================================= */

function showLocalScreen(
  stream
) {

  /*
   * Remove transmissão local anterior.
   */

  const old =
    document.getElementById(
      "local-screen-card"
    );

  if (old) {

    old.remove();

  }

  const card =
    document.createElement(
      "div"
    );

  card.className =
    "video-card local-screen-card";

  card.id =
    "local-screen-card";

  const video =
    document.createElement(
      "video"
    );

  video.autoplay =
    true;

  video.playsInline =
    true;

  /*
   * A própria tela não precisa
   * tocar áudio para você.
   *
   * Isso ajuda a evitar retorno.
   */

  video.muted =
    true;

  video.srcObject =
    stream;

  card.appendChild(
    video
  );

  const name =
    document.createElement(
      "div"
    );

  name.className =
    "video-name";

  name.textContent =
    `${myName} — Sua tela`;

  card.appendChild(
    name
  );

  /*
   * Colocar no começo da área de vídeos.
   */

  if (
    videos.firstChild
  ) {

    videos.insertBefore(
      card,
      videos.firstChild
    );

  } else {

    videos.appendChild(
      card
    );

  }

  emptyState?.classList.add(
    "hidden"
  );

  video.play()
    .catch(
      () => {}
    );
}

/* =========================================================
   PARAR TELA
========================================================= */

function stopScreenShare(
  notifyServer = true
) {

  if (
    localScreenStream
  ) {

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
   * Remove a transmissão local da tela.
   */

  const localCard =
    document.getElementById(
      "local-screen-card"
    );

  if (localCard) {

    const video =
      localCard.querySelector(
        "video"
      );

    if (video) {

      video.srcObject =
        null;

    }

    localCard.remove();
  }

  /*
   * Remove somente tracks de vídeo
   * que representam a tela.
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

  if (
    notifyServer
  ) {

    send({

      type:
        "sharing",

      value:
        false

    });

  }

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
      "No Android/iPhone o microfone está desativado."
    );

    return;

  }

  try {

    /*
     * Primeira vez:
     * solicitar microfone.
     */

    if (!localMicStream) {

      localMicStream =
        await navigator.mediaDevices.getUserMedia({

          audio: {

            echoCancellation:
              true,

            noiseSuppression:
              true,

            autoGainControl:
              true

          },

          video:
            false

        });

      /*
       * Microfone ligado somente porque
       * o usuário clicou.
       */

      micEnabled =
        true;

      /*
       * Adicionar aos peers existentes.
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
          of localMicStream.getAudioTracks()
        ) {

          track.enabled =
            true;

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
            "Erro adicionando microfone:",
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

    toast(
      "Não foi possível acessar o microfone."
    );
  }
}

/* =========================================================
   MUTE FORÇADO
========================================================= */

function setLocalMute(
  muted
) {

  if (!localMicStream) {

    micEnabled =
      !muted;

    /*
     * Mas se o servidor mandou mutado,
     * o estado deve permanecer desligado.
     */

    if (muted) {

      micEnabled =
        false;

    }

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
   ESCONDER CONTROLES MOBILE
========================================================= */

function hideMobileControls() {

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
   CHAT
========================================================= */

chatForm?.addEventListener(
  "submit",
  event => {

    event.preventDefault();

    const text =
      chatInput.value.trim();

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

function addChatMessage(
  message
) {

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

    await navigator.clipboard.writeText(
      invite
    );

    toast(
      "Convite copiado!"
    );

  } catch {

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

  stopScreenShare(
    false
  );

  if (
    localMicStream
  ) {

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
    const pc
    of peers.values()
  ) {

    try {

      pc.close();

    } catch {}

  }

  peers.clear();

  remoteStreams.clear();

  remoteTracks.clear();

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

    stopScreenShare(
      true
    );

  }
);

micBtn?.addEventListener(
  "click",
  toggleMicrophone
);

/* =========================================================
   CARREGAMENTO
========================================================= */

window.addEventListener(
  "load",
  () => {

    /*
     * Começa mutado.
     */

    micEnabled =
      false;

    updateMicButton();

    const savedName =
      localStorage.getItem(
        "hype_name"
      );

    if (
      savedName &&
      nameHome
    ) {

      nameHome.value =
        savedName;

    }

    const room =
      getRoomFromUrl();

    if (
      room &&
      savedName
    ) {

      enterRoom(
        room,
        savedName
      );

    }

    if (isMobile) {

      hideMobileControls();

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

      localStorage.setItem(
        "hype_name",
        name
      );

    }
  }
);

/* =========================================================
   ANTES DE SAIR
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
   FINAL
========================================================= */

console.log(
  "Hype Roleplay - app.js carregado corretamente."
);
```
