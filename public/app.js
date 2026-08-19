const $ = (selector) => document.querySelector(selector);

const params = new URLSearchParams(window.location.search);

let roomId = params.get("room") || "";
let myId = null;
let myName = "";
let socket = null;

let localMicStream = null;
let localScreenStream = null;

let micOn = false;
let sharing = false;
let mutedAll = false;
let isHost = false;

const peers = new Map();

const iceServers = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" }
];

/* =========================
   UTILIDADES
========================= */

function toast(message) {
  const element = $("#toast");

  if (!element) {
    alert(message);
    return;
  }

  element.textContent = message;
  element.classList.add("show");

  clearTimeout(window.__toastTimer);

  window.__toastTimer = setTimeout(() => {
    element.classList.remove("show");
  }, 3000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char];
  });
}

function normalizeRoom(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);
}

function randomRoom() {
  return Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase();
}

function showHome() {
  $("#home")?.classList.remove("hidden");
  $("#room")?.classList.add("hidden");
}

function showRoom() {
  $("#home")?.classList.add("hidden");
  $("#room")?.classList.remove("hidden");
}

function updateStatus(text) {
  const status = $("#roomStatus");

  if (status) {
    status.textContent = text;
  }
}

/* =========================
   WEBSOCKET
========================= */

function connect() {
  if (!roomId) {
    toast("Sala inválida.");
    return;
  }

  const protocol =
    window.location.protocol === "https:"
      ? "wss:"
      : "ws:";

  socket = new WebSocket(
    `${protocol}//${window.location.host}`
  );

  socket.onopen = () => {
    updateStatus("Conectando...");

    socket.send(
      JSON.stringify({
        type: "join",
        room: roomId,
        name: myName,
        password: window.__roomPassword || ""
      })
    );
  };

  socket.onerror = () => {
    toast("Não foi possível conectar ao servidor.");
  };

  socket.onclose = () => {
    updateStatus("Desconectado");
  };

  socket.onmessage = async (event) => {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    await handleMessage(message);
  };
}

/* =========================
   MENSAGENS DO SERVIDOR
========================= */

async function handleMessage(message) {
  switch (message.type) {

    case "error":
      toast(message.message);
      return;

    case "password-required": {
      const password = prompt(
        "🔐 Esta sala possui uma senha.\nDigite a senha:"
      );

      if (password === null) {
        return;
      }

      window.__roomPassword = password;

      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "join",
            room: roomId,
            name: myName,
            password
          })
        );
      }

      return;
    }

    case "joined":
      await handleJoined(message);
      return;

    case "participant-joined":
      addParticipant(message.participant);
      return;

    case "participant-left":
      removePeer(message.peerId);
      return;

    case "participants":
      renderParticipants(message.participants || []);

      mutedAll = !!message.mutedAll;

      updateMuteAllButton();

      return;

    case "participant-updated":
      updateParticipant(message.participant);
      return;

    case "signal":
      await handleSignal(message);
      return;

    case "chat":
      addChat(
        message.from,
        message.text,
        message.peerId === myId
      );
      return;

    case "mute-all":
      mutedAll = !!message.value;

      if (mutedAll) {
        forceMuteLocal();
        toast("🔇 Todos os microfones foram mutados.");
      } else {
        toast("🎙️ O mute geral foi desativado.");
      }

      updateMuteAllButton();

      return;

    case "force-mute":
      forceMuteLocal();
      toast("🔇 Seu microfone foi mutado pelo administrador.");
      return;

    case "host-changed":
      isHost = !!message.host;
      updateHostControls();

      if (isHost) {
        toast("👑 Você agora é o administrador da sala.");
      }

      return;
  }
}

/* =========================
   ENTRADA NA SALA
========================= */

async function handleJoined(message) {
  myId = message.peerId;
  roomId = message.room;

  isHost = !!message.host;
  mutedAll = !!message.mutedAll;

  history.replaceState(
    {},
    "",
    `?room=${encodeURIComponent(roomId)}`
  );

  showRoom();

  $("#roomCode").textContent = roomId;

  updateStatus("Conectado");

  renderParticipants(message.participants || []);

  updateHostControls();
  updateMuteAllButton();

  /*
   * Cria uma conexão WebRTC com cada participante
   * que já estava na sala.
   */
  for (const participant of message.participants || []) {
    if (participant.peerId === myId) {
      continue;
    }

    const pc = createPeer(
      participant.peerId,
      participant.name,
      true
    );

    try {
      const offer = await pc.createOffer();

      await pc.setLocalDescription(offer);

      sendSignal(
        participant.peerId,
        {
          sdp: pc.localDescription
        }
      );
    } catch (error) {
      console.error("Erro criando offer:", error);
    }
  }
}

/* =========================
   WEBRTC
========================= */

function createPeer(peerId, name, initiator = false) {
  if (peers.has(peerId)) {
    return peers.get(peerId).pc;
  }

  const pc = new RTCPeerConnection({
    iceServers
  });

  const state = {
    pc,
    name,
    stream: null,
    candidateQueue: []
  };

  peers.set(peerId, state);

  pc.onicecandidate = (event) => {
    if (!event.candidate) {
      return;
    }

    sendSignal(peerId, {
      candidate: event.candidate
    });
  };

  pc.ontrack = (event) => {
    const stream =
      event.streams?.[0] ||
      state.stream ||
      new MediaStream();

    if (!event.streams?.[0]) {
      stream.addTrack(event.track);
    }

    state.stream = stream;

    attachRemote(
      peerId,
      name,
      stream
    );

    hideEmpty();
  };

  pc.onconnectionstatechange = () => {
    const stateName = pc.connectionState;

    if (stateName === "failed") {
      try {
        pc.restartIce();
      } catch {}
    }

    if (
      stateName === "closed" ||
      stateName === "disconnected"
    ) {
      setTimeout(() => {
        if (
          pc.connectionState === "disconnected"
        ) {
          removePeer(peerId);
        }
      }, 5000);
    }
  };

  /*
   * Se já estamos compartilhando,
   * adiciona nossa tela nessa nova conexão.
   */
  if (localScreenStream) {
    for (const track of localScreenStream.getTracks()) {
      pc.addTrack(
        track,
        localScreenStream
      );
    }
  }

  /*
   * Se já temos microfone,
   * adiciona o áudio nessa conexão.
   */
  if (
    localMicStream &&
    micOn &&
    !mutedAll
  ) {
    for (const track of localMicStream.getTracks()) {
      pc.addTrack(
        track,
        localMicStream
      );
    }
  }

  return pc;
}

async function handleSignal(message) {
  const {
    from,
    fromName,
    signal
  } = message;

  const pc = createPeer(
    from,
    fromName || "Participante",
    false
  );

  const state = peers.get(from);

  if (!state) {
    return;
  }

  try {

    if (signal.sdp) {

      await pc.setRemoteDescription(
        new RTCSessionDescription(signal.sdp)
      );

      while (
        state.candidateQueue.length
      ) {
        const candidate =
          state.candidateQueue.shift();

        try {
          await pc.addIceCandidate(candidate);
        } catch {}
      }

      if (
        signal.sdp.type === "offer"
      ) {
        const answer =
          await pc.createAnswer();

        await pc.setLocalDescription(
          answer
        );

        sendSignal(
          from,
          {
            sdp: pc.localDescription
          }
        );
      }

      return;
    }

    if (signal.candidate) {

      const candidate =
        new RTCIceCandidate(
          signal.candidate
        );

      if (pc.remoteDescription) {
        await pc.addIceCandidate(
          candidate
        );
      } else {
        state.candidateQueue.push(
          candidate
        );
      }
    }

  } catch (error) {
    console.error(
      "Erro WebRTC:",
      error
    );
  }
}

function sendSignal(to, signal) {
  if (
    socket &&
    socket.readyState === WebSocket.OPEN
  ) {
    socket.send(
      JSON.stringify({
        type: "signal",
        to,
        signal
      })
    );
  }
}

/* =========================
   VÍDEOS REMOTOS
========================= */

function attachRemote(
  peerId,
  name,
  stream
) {
  let card =
    document.querySelector(
      `[data-peer="${peerId}"]`
    );

  if (!card) {

    card =
      document.createElement("div");

    card.className =
      "video-card";

    card.dataset.peer =
      peerId;

    card.innerHTML = `
      <video
        autoplay
        playsinline
      ></video>

      <div class="video-name">
        ${escapeHtml(name)}
      </div>
    `;

    $("#videos")?.appendChild(card);
  }

  const video =
    card.querySelector("video");

  if (video) {
    if (
      video.srcObject !== stream
    ) {
      video.srcObject = stream;
    }

    video.autoplay = true;
    video.playsInline = true;

    video.play().catch(() => {
      /*
       * Alguns navegadores bloqueiam
       * autoplay de áudio.
       */
    });
  }

  const nameElement =
    card.querySelector(
      ".video-name"
    );

  if (nameElement) {
    nameElement.textContent =
      `${name} · transmitindo`;
  }
}

function removePeer(peerId) {
  const state =
    peers.get(peerId);

  if (state) {
    try {
      state.pc.close();
    } catch {}

    peers.delete(peerId);
  }

  document
    .querySelector(
      `[data-peer="${peerId}"]`
    )
    ?.remove();

  renderParticipantsFromDOM();

  showEmpty();
}

function hideEmpty() {
  $("#emptyState")
    ?.classList.add("hidden");
}

function showEmpty() {
  const videos =
    $("#videos");

  if (
    videos &&
    videos.children.length === 0
  ) {
    $("#emptyState")
      ?.classList.remove("hidden");
  }
}

/* =========================
   COMPARTILHAMENTO DE TELA
========================= */

async function startShare() {

  if (
    !navigator.mediaDevices?.getDisplayMedia
  ) {
    toast(
      "Seu navegador não suporta compartilhamento de tela."
    );

    return;
  }

  if (sharing) {
    return;
  }

  try {

    const stream =
      await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: "always",
          frameRate: {
            ideal: 30,
            max: 60
          }
        },
        audio: true
      });

    localScreenStream =
      stream;

    sharing = true;

    hideEmpty();

    updateShareButtons();

    /*
     * Coloca a nossa própria transmissão
     * na tela.
     */
    attachLocalPreview(
      stream
    );

    /*
     * Envia tela para TODOS os participantes.
     */
    for (
      const [
        peerId,
        state
      ] of peers
    ) {

      const videoTrack =
        stream.getVideoTracks()[0];

      const audioTrack =
        stream.getAudioTracks()[0];

      const videoSender =
        state.pc
          .getSenders()
          .find(
            sender =>
              sender.track?.kind === "video"
          );

      if (videoSender) {

        await videoSender.replaceTrack(
          videoTrack
        );

      } else {

        state.pc.addTrack(
          videoTrack,
          stream
        );
      }

      /*
       * ÁUDIO DA TELA
       */
      if (audioTrack) {

        const audioSender =
          state.pc
            .getSenders()
            .find(
              sender =>
                sender.track?.kind === "audio"
            );

        if (audioSender) {

          await audioSender.replaceTrack(
            audioTrack
          );

        } else {

          /*
           * Se já existe áudio do microfone,
           * precisamos criar uma negociação.
           */
          state.pc.addTrack(
            audioTrack,
            stream
          );
        }
      }

      const offer =
        await state.pc.createOffer();

      await state.pc.setLocalDescription(
        offer
      );

      sendSignal(
        peerId,
        {
          sdp: state.pc.localDescription
        }
      );
    }

    const screenTrack =
      stream.getVideoTracks()[0];

    if (screenTrack) {
      screenTrack.onended =
        stopShare;
    }

    sendServerSharing(true);

    toast(
      "🖥️ Sua tela está sendo compartilhada."
    );

  } catch (error) {

    console.error(
      "Compartilhamento:",
      error
    );

    if (
      error.name !== "AbortError" &&
      error.name !== "NotAllowedError"
    ) {
      toast(
        "Não foi possível compartilhar a tela."
      );
    }
  }
}

function attachLocalPreview(stream) {

  let card =
    document.querySelector(
      '[data-peer="local"]'
    );

  if (!card) {

    card =
      document.createElement("div");

    card.className =
      "video-card local-video";

    card.dataset.peer =
      "local";

    card.innerHTML = `
      <video
        autoplay
        muted
        playsinline
      ></video>

      <div class="video-name">
        Você · transmitindo
      </div>
    `;

    $("#videos")?.appendChild(card);
  }

  const video =
    card.querySelector("video");

  video.srcObject =
    stream;

  video.muted = true;

  video.play().catch(() => {});
}

function removeLocalPreview() {
  document
    .querySelector(
      '[data-peer="local"]'
    )
    ?.remove();
}

async function stopShare() {

  if (!localScreenStream) {
    return;
  }

  const stream =
    localScreenStream;

  localScreenStream =
    null;

  sharing = false;

  for (
    const track of stream.getTracks()
  ) {
    try {
      track.stop();
    } catch {}
  }

  removeLocalPreview();

  /*
   * Remove a tela das conexões.
   */
  for (
    const state of peers.values()
  ) {

    const videoSender =
      state.pc
        .getSenders()
        .find(
          sender =>
            sender.track?.kind === "video"
        );

    if (videoSender) {

      try {
        await videoSender.replaceTrack(
          null
        );
      } catch {}
    }
  }

  updateShareButtons();

  sendServerSharing(false);

  showEmpty();

  toast(
    "⏹️ Transmissão encerrada."
  );
}

function sendServerSharing(value) {

  if (
    socket &&
    socket.readyState === WebSocket.OPEN
  ) {
    socket.send(
      JSON.stringify({
        type: "sharing",
        value
      })
    );
  }
}

function updateShareButtons() {

  $("#shareBtn")
    ?.classList.toggle(
      "hidden",
      sharing
    );

  $("#shareCenterBtn")
    ?.classList.toggle(
      "hidden",
      sharing
    );

  $("#stopShareBtn")
    ?.classList.toggle(
      "hidden",
      !sharing
    );
}

/* =========================
   MICROFONE
========================= */

async function toggleMic() {

  if (mutedAll) {
    toast(
      "🔇 O administrador bloqueou os microfones."
    );

    return;
  }

  if (!micOn) {
    await startMic();
  } else {
    stopMic();
  }
}

async function startMic() {

  try {

    if (!localMicStream) {

      localMicStream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
    }

    const track =
      localMicStream.getAudioTracks()[0];

    if (!track) {
      throw new Error(
        "Microfone não encontrado."
      );
    }

    track.enabled = true;

    micOn = true;

    for (
      const [
        peerId,
        state
      ] of peers
    ) {

      const audioSender =
        state.pc
          .getSenders()
          .find(
            sender =>
              sender.track?.kind === "audio"
          );

      if (audioSender) {

        await audioSender.replaceTrack(
          track
        );

      } else {

        state.pc.addTrack(
          track,
          localMicStream
        );

        const offer =
          await state.pc.createOffer();

        await state.pc.setLocalDescription(
          offer
        );

        sendSignal(
          peerId,
          {
            sdp: state.pc.localDescription
          }
        );
      }
    }

    updateMicButton();

    sendMicState(true);

    toast(
      "🎙️ Microfone ligado."
    );

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

function stopMic() {

  micOn = false;

  if (localMicStream) {

    for (
      const track of
      localMicStream.getAudioTracks()
    ) {
      track.enabled = false;
    }
  }

  for (
    const state of peers.values()
  ) {

    const sender =
      state.pc
        .getSenders()
        .find(
          sender =>
            sender.track?.kind === "audio"
        );

    /*
     * Não remove necessariamente o áudio,
     * apenas desliga o track local.
     */
    if (sender?.track) {
      sender.track.enabled = false;
    }
  }

  updateMicButton();

  sendMicState(false);

  toast(
    "🎙️ Microfone desligado."
  );
}

function forceMuteLocal() {

  micOn = false;

  if (localMicStream) {

    for (
      const track of
      localMicStream.getAudioTracks()
    ) {
      track.enabled = false;
    }
  }

  updateMicButton();
}

function sendMicState(value) {

  if (
    socket &&
    socket.readyState === WebSocket.OPEN
  ) {
    socket.send(
      JSON.stringify({
        type: "mic",
        value
      })
    );
  }
}

function updateMicButton() {

  const button =
    $("#micBtn");

  if (!button) {
    return;
  }

  button.innerHTML =
    micOn
      ? "<span>🎙️</span> Microfone ligado"
      : "<span>🔇</span> Microfone";
}

/* =========================
   PARTICIPANTES
========================= */

function participantHTML(participant) {

  const initial =
    (
      participant.name ||
      "?"
    )
      .slice(0, 1)
      .toUpperCase();

  const host =
    participant.host
      ? `<span class="host-badge">👑</span>`
      : "";

  const sharing =
    participant.sharing
      ? `<span class="sharing-dot" title="Transmitindo"></span>`
      : "";

  const mic =
    participant.micOn
      ? "🎙️"
      : "🔇";

  return `
    <div
      class="participant"
      data-participant="${participant.peerId}"
    >

      <div class="avatar">
        ${escapeHtml(initial)}
      </div>

      <div class="pname">
        ${escapeHtml(participant.name)}
        ${
          participant.peerId === myId
            ? " (você)"
            : ""
        }
      </div>

      ${host}

      ${sharing}

      <span class="participant-mic">
        ${mic}
      </span>

      ${
        isHost &&
        participant.peerId !== myId
          ? `
            <button
              class="mute-person"
              data-peer="${participant.peerId}"
              title="Mutar participante"
            >
              🔇
            </button>
          `
          : ""
      }

    </div>
  `;
}

function renderParticipants(list) {

  const container =
    $("#participants");

  if (!container) {
    return;
  }

  container.innerHTML =
    list
      .map(participantHTML)
      .join("");

  $("#count").textContent =
    list.length;

  bindParticipantButtons();
}

function bindParticipantButtons() {

  document
    .querySelectorAll(
      ".mute-person"
    )
    .forEach(button => {

      button.onclick = () => {

        const peerId =
          button.dataset.peer;

        if (
          socket?.readyState ===
          WebSocket.OPEN
        ) {
          socket.send(
            JSON.stringify({
              type: "mute-peer",
              peerId
            })
          );
        }
      };
    });
}

function addParticipant(participant) {

  const container =
    $("#participants");

  if (!container) {
    return;
  }

  const exists =
    document.querySelector(
      `[data-participant="${participant.peerId}"]`
    );

  if (!exists) {

    container.insertAdjacentHTML(
      "beforeend",
      participantHTML(participant)
    );
  }

  renderParticipantsFromDOM();

  bindParticipantButtons();
}

function updateParticipant(participant) {

  const old =
    document.querySelector(
      `[data-participant="${participant.peerId}"]`
    );

  if (old) {

    old.outerHTML =
      participantHTML(participant);

  } else {

    addParticipant(
      participant
    );
  }

  renderParticipantsFromDOM();

  bindParticipantButtons();
}

function renderParticipantsFromDOM() {

  const count =
    document.querySelectorAll(
      ".participant"
    ).length;

  if ($("#count")) {
    $("#count").textContent =
      count;
  }
}

/* =========================
   ADMINISTRADOR
========================= */

function updateHostControls() {

  const button =
    $("#muteAllBtn");

  if (button) {
    button.classList.toggle(
      "hidden",
      !isHost
    );
  }

  bindParticipantButtons();
}

function toggleMuteAll() {

  if (!isHost) {
    toast(
      "Somente o administrador pode usar essa função."
    );

    return;
  }

  mutedAll =
    !mutedAll;

  if (
    socket?.readyState ===
    WebSocket.OPEN
  ) {

    socket.send(
      JSON.stringify({
        type: "mute-all",
        value: mutedAll
      })
    );
  }

  updateMuteAllButton();
}

function updateMuteAllButton() {

  const button =
    $("#muteAllBtn");

  if (!button) {
    return;
  }

  button.textContent =
    mutedAll
      ? "🔊 Liberar microfones"
      : "🔇 Mutar todos";
}

/* =========================
   CHAT
========================= */

function addChat(
  from,
  text,
  mine
) {

  const container =
    $("#chatMessages");

  if (!container) {
    return;
  }

  const message =
    document.createElement("div");

  message.className =
    "message";

  message.innerHTML = `
    <div class="meta">
      ${
        mine
          ? "Você"
          : escapeHtml(from)
      }
    </div>

    <div class="text">
      ${escapeHtml(text)}
    </div>
  `;

  container.appendChild(
    message
  );

  container.scrollTop =
    container.scrollHeight;
}

/* =========================
   CONVITE
========================= */

async function copyInvite() {

  const url =
    `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;

  try {

    await navigator.clipboard.writeText(
      url
    );

    toast(
      "🔗 Link da sala copiado!"
    );

  } catch {

    prompt(
      "Copie o link da sala:",
      url
    );
  }
}

/* =========================
   ENTRAR
========================= */

function enterRoom() {

  myName =
    (
      $("#nameHome")?.value ||
      "Convidado"
    )
      .trim()
      .slice(0, 30);

  if (!myName) {
    myName =
      "Convidado";
  }

  roomId =
    normalizeRoom(
      roomId ||
      $("#roomInput")?.value
    );

  if (!roomId) {
    roomId =
      randomRoom();
  }

  const passwordInput =
    $("#roomPassword");

  window.__roomPassword =
    passwordInput?.value || "";

  history.replaceState(
    {},
    "",
    `?room=${encodeURIComponent(roomId)}`
  );

  showRoom();

  connect();
}

/* =========================
   EVENTOS
========================= */

$("#createBtn")?.addEventListener(
  "click",
  () => {

    roomId =
      randomRoom();

    enterRoom();
  }
);

$("#joinBtn")?.addEventListener(
  "click",
  () => {

    roomId =
      normalizeRoom(
        $("#roomInput")?.value
      );

    if (!roomId) {

      toast(
        "Digite o código da sala."
      );

      return;
    }

    enterRoom();
  }
);

$("#shareBtn")?.addEventListener(
  "click",
  startShare
);

$("#shareCenterBtn")?.addEventListener(
  "click",
  startShare
);

$("#stopShareBtn")?.addEventListener(
  "click",
  stopShare
);

$("#micBtn")?.addEventListener(
  "click",
  toggleMic
);

$("#muteAllBtn")?.addEventListener(
  "click",
  toggleMuteAll
);

$("#copyBtn")?.addEventListener(
  "click",
  copyInvite
);

$("#inviteBtn")?.addEventListener(
  "click",
  copyInvite
);

$("#leaveBtn")?.addEventListener(
  "click",
  () => {

    try {
      stopShare();
    } catch {}

    try {
      if (localMicStream) {
        localMicStream
          .getTracks()
          .forEach(
            track =>
              track.stop()
          );
      }
    } catch {}

    try {
      socket?.close();
    } catch {}

    window.location.href =
      window.location.pathname;
  }
);

$("#chatForm")?.addEventListener(
  "submit",
  (event) => {

    event.preventDefault();

    const input =
      $("#chatInput");

    const text =
      input?.value.trim();

    if (
      !text ||
      socket?.readyState !==
      WebSocket.OPEN
    ) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "chat",
        text
      })
    );

    input.value = "";
  }
);

$("#roomInput")?.addEventListener(
  "keydown",
  (event) => {

    if (event.key === "Enter") {
      $("#joinBtn")?.click();
    }
  }
);

/* =========================
   LINK DIRETO
========================= */

if (roomId) {

  $("#roomInput").value =
    roomId;

  /*
   * O usuário ainda informa o nome.
   * Depois pode entrar normalmente.
   */
  showHome();
}
