```javascript
/* =========================================================
   HYPE ROLEPLAY
   Compartilhamento de tela - WebRTC
   Android/iPhone = somente assistir
   PC = transmitir + microfone
========================================================= */

const $ = id => document.getElementById(id);

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

  const name =
    nameHome.value.trim();

  if (!name) {

    toast("Digite seu nome primeiro.");

    nameHome.focus();

    return;
  }

  const room = generateRoom();

  saveName(name);

  enterRoom(room, name);

});


/* =========================================================
   ENTRAR
========================================================= */

joinBtn?.addEventListener("click", () => {

  const name =
    nameHome.value.trim();

  const room =
    roomInput.value
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


roomInput?.addEventListener("keydown", event => {

  if (event.key === "Enter") {
    joinBtn?.click();
  }

});


nameHome?.addEventListener("keydown", event => {

  if (event.key === "Enter") {
    createBtn?.click();
  }

});


/* =========================================================
   ENTRAR NA SALA
========================================================= */

function enterRoom(room, name) {

  roomId =
    room
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 32);

  myName =
    name
      .trim()
      .slice(0, 30);

  if (!roomId) {

    toast("Código de sala inválido.");

    return;
  }

  updateUrl(roomId);

  home?.classList.add("hidden");

  roomPage?.classList.remove("hidden");

  roomCodeEl.textContent = roomId;

  roomStatus.textContent = "Conectando...";

  /*
   * IMPORTANTE:
   * Todo participante entra mutado.
   */

  micEnabled = false;

  updateMicButton();

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
   WEBSOCKET
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

  roomStatus.textContent = "Conectando...";

  socket = new WebSocket(websocketUrl());

  socket.addEventListener("open", () => {

    reconnectState.attempts = 0;

    roomStatus.textContent = "Conectado";

    send({
      type: "join",
      room: roomId,
      name: myName,
      mobile: isMobile
    });

  });


  socket.addEventListener("message", event => {

    let message;

    try {

      message =
        JSON.parse(event.data);

    } catch {

      return;
    }

    handleMessage(message);

  });


  socket.addEventListener("close", () => {

    roomStatus.textContent = "Desconectado";

    scheduleReconnect();

  });


  socket.addEventListener("error", () => {

    roomStatus.textContent =
      "Erro de conexão";

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

      break;


    case "participant-left":

      removeParticipant(msg.peerId);

      break;


    case "participant-updated":

      updateParticipant(msg.participant);

      break;


    case "participants-refresh":

      refreshParticipants(msg.participants);

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

      setTimeout(
        leaveRoom,
        1000
      );

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

  roomId = msg.room;

  roomCodeEl.textContent = roomId;

  /*
   * Todos entram mutados.
   */

  micEnabled = false;

  updateMicButton();

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

  for (const participant of list) {

    participants.set(
      participant.peerId,
      participant
    );

  }

  renderParticipants();
}


function addParticipant(participant) {

  participants.set(
    participant.peerId,
    participant
  );

  renderParticipants();
}


function updateParticipant(participant) {

  participants.set(
    participant.peerId,
    participant
  );

  renderParticipants();
}


function removeParticipant(peerId) {

  participants.delete(peerId);

  const pc = peers.get(peerId);

  if (pc) {

    try {
      pc.close();
    } catch {}

    peers.delete(peerId);
  }

  removeVideo(peerId);

  renderParticipants();
}


/* =========================================================
   PARTICIPANTES NA TELA
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

    row.className = "participant";


    const avatar =
      document.createElement("div");

    avatar.className = "avatar";

    avatar.textContent =
      (
        participant.name || "?"
      )
        .charAt(0)
        .toUpperCase();


    const name =
      document.createElement("div");

    name.className = "pname";

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

      dot.title =
        "Compartilhando tela";

      row.appendChild(dot);

    }


    /*
     * Administração
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

      mute.className = "mini-btn";

      mute.type = "button";

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
        document.createElement("button");

      kick.className =
        "mini-btn kick-btn";

      kick.type = "button";

      kick.title =
        "Expulsar usuário";

      kick.textContent = "✕";


      kick.addEventListener(
        "click",
        event => {

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


  /*
   * Mostra quantidade correta.
   */

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

    roomPage.classList.add("admin-mode");

    if (adminButton) {
      adminButton.style.display =
        "inline-flex";
    }

  } else {

    roomPage.classList.remove("admin-mode");

    if (adminButton) {
      adminButton.style.display =
        "none";
    }

    adminPanel?.classList.add("hidden");

  }

  renderParticipants();
}


window.toggleAdminPanel = function () {

  if (!isAdmin) {

    toast(
      "Somente o administrador pode abrir este menu."
    );

    return;
  }

  adminPanel?.classList.toggle("hidden");
};


window.adminMuteAll = function () {

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


window.adminStopShares = function () {

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


window.adminCopyInvite = function () {

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
   * Microfone:
   * só adiciona se realmente estiver ativo.
   */

  if (
    localMicStream &&
    micEnabled
  ) {

    for (
      const track of
      localMicStream.getAudioTracks()
    ) {

      pc.addTrack(
        track,
        localMicStream
      );

    }

  }


  /*
   * Tela:
   * adiciona somente no PC que estiver transmitindo.
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


  pc.onicecandidate =
    event => {

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


  pc.ontrack =
    event => {

      const stream =
        event.streams &&
        event.streams[0];

      if (!stream) {
        return;
      }

      showRemoteVideo(
        peerId,
        stream
      );

    };


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

        type: "signal",

        to: peerId,

        signal: {

          type: "answer",

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

      if (signal.candidate) {

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

    video.autoplay = true;

    video.playsInline = true;

    video.controls = false;

    /*
     * IMPORTANTE:
     * Não mutamos vídeos remotos.
     * Isso permite ouvir os participantes.
     */

    video.muted = false;

    video.volume = 1;


    card.appendChild(video);


    const name =
      document.createElement("div");

    name.className =
      "video-name";


    const participant =
      participants.get(peerId);


    name.textContent =
      participant?.name ||
      "Participante";


    card.appendChild(name);


    videos.appendChild(card);


    video.srcObject = stream;


    /*
     * Tenta iniciar automaticamente.
     */

    video.play()
      .catch(() => {

        /*
         * Se o navegador bloquear autoplay,
         * o usuário pode clicar.
         */

        card.classList.add(
          "audio-locked"
        );

      });


    card.addEventListener(
      "click",
      () => {

        video.muted = false;

        video.volume = 1;

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

      video.srcObject = stream;

      video.play()
        .catch(() => {});

    }

  }


  emptyState?.classList.add("hidden");

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

  /*
   * CELULAR NÃO TRANSMITE.
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

        /*
         * Tenta capturar áudio do sistema.
         */

        audio: true

      });


    localScreenStream =
      stream;


    /*
     * MOSTRAR MINHA PRÓPRIA TELA
     *
     * Isso não cria áudio duplicado porque
     * o preview local fica SEM ÁUDIO.
     */

    showLocalScreen(stream);


    const videoTrack =
      stream.getVideoTracks()[0];


    if (videoTrack) {

      videoTrack.addEventListener(
        "ended",
        () => {

          stopScreenShare(true);

        }
      );

    }


    /*
     * Enviar tela para todos os participantes.
     */

    for (
      const [peerId, pc]
      of peers
    ) {

      /*
       * Evita adicionar a mesma tela
       * duas vezes.
       */

      const existingVideoSender =
        pc.getSenders().find(
          sender =>
            sender.track &&
            sender.track.kind === "video"
        );

      if (existingVideoSender) {

        try {

          await existingVideoSender.replaceTrack(
            videoTrack
          );

        } catch {

          pc.addTrack(
            videoTrack,
            stream
          );

        }

      } else {

        pc.addTrack(
          videoTrack,
          stream
        );

      }


      /*
       * Áudio da tela, se existir.
       */

      const audioTracks =
        stream.getAudioTracks();

      for (
        const audioTrack
        of audioTracks
      ) {

        const hasAudioSender =
          pc.getSenders().some(
            sender =>
              sender.track &&
              sender.track.kind === "audio"
          );

        /*
         * Só adiciona áudio da tela
         * se ainda não houver áudio.
         */

        if (!hasAudioSender) {

          pc.addTrack(
            audioTrack,
            stream
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
          "Renegociação:",
          error
        );

      }

    }


    send({

      type: "sharing",

      value: true

    });


    shareBtn?.classList.add("hidden");

    shareCenterBtn?.classList.add("hidden");

    stopShareBtn?.classList.remove("hidden");


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
   MINHA PRÓPRIA TELA
========================================================= */

function showLocalScreen(stream) {

  if (!videos) {
    return;
  }


  let card =
    document.getElementById(
      "local-screen"
    );


  if (!card) {

    card =
      document.createElement("div");

    card.id =
      "local-screen";

    card.className =
      "video-card local-screen-card";


    const video =
      document.createElement("video");

    video.autoplay = true;

    video.playsInline = true;

    video.muted = true;

    /*
     * O preview local NÃO reproduz áudio.
     * Isso evita ouvir sua própria voz/tela duas vezes.
     */

    video.volume = 0;

    video.srcObject = stream;


    const name =
      document.createElement("div");

    name.className =
      "video-name";

    name.textContent =
      `${myName} — Minha transmissão`;


    card.appendChild(video);

    card.appendChild(name);

    videos.prepend(card);


  } else {

    const video =
      card.querySelector("video");

    if (video) {

      video.srcObject =
        stream;

    }

  }


  emptyState?.classList.add("hidden");
}


/* =========================================================
   PARAR COMPARTILHAMENTO
========================================================= */

function stopScreenShare(
  notifyServer = true
) {

  if (localScreenStream) {

    for (
      const track of
      localScreenStream.getTracks()
    ) {

      try {
        track.stop();
      } catch {}

    }

    localScreenStream = null;

  }


  /*
   * Remover preview local.
   */

  const localCard =
    document.getElementById(
      "local-screen"
    );

  localCard?.remove();


  /*
   * Remover somente os vídeos da tela.
   * NÃO removeremos áudio do microfone.
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


  if (notifyServer) {

    send({

      type: "sharing",

      value: false

    });

  }


  shareBtn?.classList.remove("hidden");

  shareCenterBtn?.classList.remove("hidden");

  stopShareBtn?.classList.add("hidden");


  if (
    videos &&
    videos.children.length === 0
  ) {

    emptyState?.classList.remove(
      "hidden"
    );

  }


  toast(
    "Transmissão encerrada."
  );

}


/* =========================================================
   MICROFONE
========================================================= */

async function toggleMicrophone() {

  /*
   * CELULAR NÃO USA MICROFONE.
   */

  if (isMobile) {

    toast(
      "No celular o microfone está desativado."
    );

    return;
  }


  try {

    /*
     * PRIMEIRO CLIQUE:
     * pede acesso ao microfone.
     */

    if (!localMicStream) {

      localMicStream =
        await navigator.mediaDevices.getUserMedia({

          audio: true,

          video: false

        });


      micEnabled = true;


      /*
       * Adiciona o microfone aos peers.
       */

      for (
        const [peerId, pc]
        of peers
      ) {

        const alreadyAdded =
          pc.getSenders().some(
            sender =>
              sender.track &&
              sender.track.kind === "audio"
          );

        if (!alreadyAdded) {

          for (
            const track
            of localMicStream.getAudioTracks()
          ) {

            pc.addTrack(
              track,
              localMicStream
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
            "Microfone:",
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

      type: "mic",

      muted:
        !micEnabled

    });

  } catch (error) {

    console.error(error);

    toast(
      "Não foi possível acessar o microfone."
    );

  }

}


/* =========================================================
   MUTE FORÇADO
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
  event => {

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

  item.className = "message";


  const meta =
    document.createElement("div");

  meta.className = "meta";

  meta.textContent =
    message.from ||
    "Convidado";


  const text =
    document.createElement("div");

  text.className = "text";

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

    document.execCommand("copy");

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

    localMicStream = null;

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


  roomPage?.classList.add("hidden");

  home?.classList.remove("hidden");


  const url =
    new URL(
      window.location.href
    );

  url.searchParams.delete("room");

  history.replaceState(
    {},
    "",
    url
  );


  roomId = "";

  myPeerId = "";

  isAdmin = false;

  micEnabled = false;

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
   SALVAR NOME
========================================================= */

function saveName(name) {

  if (!name) {
    return;
  }

  localStorage.setItem(
    "hype_name",
    name
  );

}


nameHome?.addEventListener(
  "change",
  () => {

    saveName(
      nameHome.value.trim()
    );

  }
);


/* =========================================================
   QUANDO ABRE
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
     * Celular:
     * somente assistir.
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

  }
);


/* =========================================================
   SEGURANÇA
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
```
