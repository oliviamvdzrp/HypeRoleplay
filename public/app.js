const $ = (selector) => document.querySelector(selector);

const params = new URLSearchParams(location.search);

let roomId = params.get("room") || "";
let myId = null;
let myName = "";
let socket = null;

let sharing = false;
let micOn = false;
let mutedByAdmin = false;
let isHost = false;

let localScreen = null;
let localMic = null;

const peers = new Map();

const iceServers = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" }
];

/* =========================================================
   UTILIDADES
========================================================= */

function toast(text) {
  const el = $("#toast");

  if (!el) return;

  el.textContent = text;
  el.classList.add("show");

  clearTimeout(window.__toast);

  window.__toast = setTimeout(() => {
    el.classList.remove("show");
  }, 3000);
}

function randomRoom() {
  return Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase();
}

function normalizeRoom(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[char]
  );
}

/* =========================================================
   WEBSOCKET
========================================================= */

function connect(password = "") {
  const protocol =
    location.protocol === "https:" ? "wss" : "ws";

  socket = new WebSocket(
    `${protocol}://${location.host}`
  );

  socket.onopen = () => {
    socket.send(
      JSON.stringify({
        type: "join",
        room: roomId,
        name: myName,
        password
      })
    );

    if ($("#roomStatus")) {
      $("#roomStatus").textContent = "Conectado";
    }
  };

  socket.onclose = () => {
    if ($("#roomStatus")) {
      $("#roomStatus").textContent = "Desconectado";
    }
  };

  socket.onerror = () => {
    toast("Erro na conexão com o servidor.");
  };

  socket.onmessage = async (event) => {
    let msg;

    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    /* ERRO */
    if (msg.type === "error") {
      toast(msg.message);
      return;
    }

    /* SENHA */
    if (msg.type === "password-required") {
      showPasswordModal();
      return;
    }

    /* ENTROU */
    if (msg.type === "joined") {
      myId = msg.peerId;

      isHost = msg.host === myId;

      if ($("#roomCode")) {
        $("#roomCode").textContent = msg.room;
      }

      renderParticipants(msg.participants || []);

      updateAdminInterface();

      if (msg.mutedAll) {
        mutedByAdmin = true;
      }

      /*
       * IMPORTANTE:
       * O participante novo cria conexão com os existentes.
       */
      for (const participant of msg.participants || []) {
        if (participant.peerId === myId) continue;

        const pc = createPeer(
          participant.peerId,
          participant.name,
          true
        );

        try {
          const offer = await pc.createOffer();

          await pc.setLocalDescription(offer);

          sendSignal(participant.peerId, {
            sdp: pc.localDescription
          });
        } catch (error) {
          console.error("Erro criando oferta:", error);
        }
      }

      return;
    }

    /* NOVO PARTICIPANTE */
    if (msg.type === "participant-joined") {
      addParticipant(msg.participant);
      return;
    }

    /* PARTICIPANTE ATUALIZADO */
    if (msg.type === "participant-updated") {
      updateParticipant(msg.participant);
      return;
    }

    /* PARTICIPANTE SAIU */
    if (msg.type === "participant-left") {
      removePeer(msg.peerId);
      return;
    }

    /* TROCA DE HOST */
    if (msg.type === "host-changed") {
      isHost = msg.peerId === myId;

      updateAdminInterface();

      if (isHost) {
        toast("Você agora é o administrador da sala.");
      }

      return;
    }

    /* MUTAR TODOS */
    if (msg.type === "mute-all") {
      mutedByAdmin = !!msg.value;

      if (mutedByAdmin) {
        disableMyMicrophone();

        toast(
          "O administrador mutou os microfones da sala."
        );
      } else {
        toast(
          "O administrador liberou os microfones."
        );
      }

      updateMicButton();

      return;
    }

    /* WEBRTC */
    if (msg.type === "signal") {
      await handleSignal(msg);
      return;
    }

    /* CHAT */
    if (msg.type === "chat") {
      addChat(
        msg.from,
        msg.text,
        msg.peerId === myId
      );
    }
  };
}

/* =========================================================
   SINALIZAÇÃO WEBRTC
========================================================= */

function sendSignal(to, signal) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(
    JSON.stringify({
      type: "signal",
      to,
      signal
    })
  );
}

function createPeer(
  peerId,
  name,
  initiator = false
) {
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
    candidateQueue: [],
    remoteVideo: null
  };

  peers.set(peerId, state);

  /* ICE */
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal(peerId, {
        candidate: event.candidate
      });
    }
  };

  /* RECEBE ÁUDIO/VÍDEO */
  pc.ontrack = (event) => {
    let stream = state.stream;

    if (!stream) {
      stream = new MediaStream();
      state.stream = stream;
    }

    /*
     * Evita adicionar a mesma track duas vezes.
     */
    if (
      !stream.getTracks().some(
        (track) => track.id === event.track.id
      )
    ) {
      stream.addTrack(event.track);
    }

    attachRemote(
      peerId,
      name,
      stream
    );

    hideEmpty();
  };

  pc.onconnectionstatechange = () => {
    const stateName = pc.connectionState;

    if (
      stateName === "failed" ||
      stateName === "disconnected"
    ) {
      console.warn(
        `Conexão com ${name}: ${stateName}`
      );
    }

    if (stateName === "closed") {
      removePeer(peerId);
    }
  };

  /*
   * Se eu já estiver transmitindo,
   * adiciona minha tela para o novo participante.
   */
  if (localScreen) {
    for (const track of localScreen.getTracks()) {
      pc.addTrack(track, localScreen);
    }
  }

  /*
   * Se meu microfone estiver ligado,
   * adiciona o áudio para o novo participante.
   */
  if (localMic && micOn && !mutedByAdmin) {
    pc.addTrack(localMic, localMicStream());
  }

  return pc;
}

function localMicStream() {
  if (!localMic) {
    return new MediaStream();
  }

  return new MediaStream([localMic]);
}

/* =========================================================
   WEBRTC SIGNAL
========================================================= */

async function handleSignal(msg) {
  const {
    from,
    fromName,
    signal
  } = msg;

  const pc = createPeer(
    from,
    fromName || "Participante",
    false
  );

  const state = peers.get(from);

  if (!state) return;

  try {
    if (signal.sdp) {
      await pc.setRemoteDescription(
        signal.sdp
      );

      while (
        state.candidateQueue.length
      ) {
        const candidate =
          state.candidateQueue.shift();

        try {
          await pc.addIceCandidate(candidate);
        } catch (error) {
          console.warn(
            "Erro adicionando ICE:",
            error
          );
        }
      }

      if (
        signal.sdp.type === "offer"
      ) {
        const answer =
          await pc.createAnswer();

        await pc.setLocalDescription(
          answer
        );

        sendSignal(from, {
          sdp: pc.localDescription
        });
      }
    }

    if (signal.candidate) {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(
          signal.candidate
        );
      } else {
        state.candidateQueue.push(
          signal.candidate
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

/* =========================================================
   VÍDEO REMOTO
========================================================= */

function attachRemote(
  peerId,
  name,
  stream
) {
  let card = document.querySelector(
    `[data-peer="${peerId}"]`
  );

  if (!card) {
    card =
      document.createElement("div");

    card.className = "video-card";

    card.dataset.peer = peerId;

    card.innerHTML = `
      <video
        autoplay
        playsinline
        controls
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
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    /*
     * O navegador pode bloquear autoplay
     * com áudio. Tentamos tocar.
     */
    video.play().catch(() => {
      const playButton =
        document.createElement("button");

      playButton.textContent =
        "🔊 Ativar áudio";

      playButton.className =
        "video-audio-button";

      playButton.onclick = () => {
        video.muted = false;

        video
          .play()
          .catch(() => {});

        playButton.remove();
      };

      if (
        !card.querySelector(
          ".video-audio-button"
        )
      ) {
        card.appendChild(
          playButton
        );
      }
    });
  }

  stateFor(peerId).remoteVideo =
    video;
}

function stateFor(peerId) {
  return peers.get(peerId) || {};
}

/* =========================================================
   REMOVER PARTICIPANTE
========================================================= */

function removePeer(peerId) {
  const state = peers.get(peerId);

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

  document
    .querySelector(
      `[data-participant="${peerId}"]`
    )
    ?.remove();

  renderParticipantsFromDOM();

  if (
    $("#videos") &&
    !$("#videos").children.length
  ) {
    showEmpty();
  }
}

/* =========================================================
   COMPARTILHAR TELA
========================================================= */

async function startShare() {
  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getDisplayMedia
  ) {
    toast(
      "Seu navegador não permite compartilhamento de tela."
    );

    return;
  }

  if (sharing) {
    toast(
      "Você já está transmitindo."
    );

    return;
  }

  try {
    /*
     * AUDIO TRUE:
     * permite áudio de aba/janela/tela
     * quando o navegador disponibilizar.
     */
    localScreen =
      await navigator.mediaDevices.getDisplayMedia(
        {
          video: {
            cursor: "always",
            frameRate: {
              ideal: 30,
              max: 60
            }
          },

          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        }
      );

    const videoTrack =
      localScreen.getVideoTracks()[0];

    if (!videoTrack) {
      throw new Error(
        "Nenhum vídeo foi selecionado."
      );
    }

    sharing = true;

    /*
     * MOSTRA A PRÓPRIA TELA
     */
    attachLocalScreen();

    hideEmpty();

    updateShareButtons();

    /*
     * Envia a tela para TODOS.
     */
    for (const [
      peerId,
      state
    ] of peers) {
      const pc = state.pc;

      const videoSender =
        pc.getSenders().find(
          (sender) =>
            sender.track?.kind === "video"
        );

      if (videoSender) {
        await videoSender.replaceTrack(
          videoTrack
        );
      } else {
        for (
          const track of localScreen.getTracks()
        ) {
          pc.addTrack(
            track,
            localScreen
          );
        }

        const offer =
          await pc.createOffer();

        await pc.setLocalDescription(
          offer
        );

        sendSignal(peerId, {
          sdp: pc.localDescription
        });
      }
    }

    /*
     * Se o usuário compartilhar
     * áudio da tela, envia junto.
     */
    const audioTrack =
      localScreen.getAudioTracks()[0];

    if (audioTrack) {
      for (const [
        peerId,
        state
      ] of peers) {
        const audioSender =
          state.pc
            .getSenders()
            .find(
              (sender) =>
                sender.track?.kind === "audio"
            );

        if (audioSender) {
          await audioSender.replaceTrack(
            audioTrack
          );
        }
      }

      toast(
        "Tela compartilhada com áudio."
      );
    } else {
      toast(
        "Tela compartilhada. O navegador não disponibilizou áudio dessa fonte."
      );
    }

    videoTrack.onended = () => {
      stopShare();
    };

    socket?.send(
      JSON.stringify({
        type: "sharing",
        value: true
      })
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

/* =========================================================
   MOSTRAR MINHA PRÓPRIA TELA
========================================================= */

function attachLocalScreen() {
  if (!localScreen) return;

  let card =
    document.querySelector(
      '[data-peer="local"]'
    );

  if (!card) {
    card =
      document.createElement("div");

    card.className =
      "video-card local-video";

    card.dataset.peer = "local";

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

  video.srcObject = localScreen;

  video.muted = true;

  video.play().catch(() => {});
}

/* =========================================================
   PARAR TELA
========================================================= */

function stopShare() {
  if (!localScreen) return;

  try {
    localScreen
      .getTracks()
      .forEach((track) => {
        track.stop();
      });
  } catch {}

  localScreen = null;

  sharing = false;

  document
    .querySelector(
      '[data-peer="local"]'
    )
    ?.remove();

  for (const state of peers.values()) {
    const videoSender =
      state.pc
        .getSenders()
        .find(
          (sender) =>
            sender.track?.kind === "video"
        );

    if (videoSender) {
      videoSender
        .replaceTrack(null)
        .catch(() => {});
    }

    const audioSender =
      state.pc
        .getSenders()
        .find(
          (sender) =>
            sender.track?.kind === "audio"
        );

    /*
     * O áudio da tela também para.
     */
    if (
      audioSender &&
      !micOn
    ) {
      audioSender
        .replaceTrack(null)
        .catch(() => {});
    }
  }

  socket?.send(
    JSON.stringify({
      type: "sharing",
      value: false
    })
  );

  updateShareButtons();

  if (
    $("#videos") &&
    !$("#videos").children.length
  ) {
    showEmpty();
  }

  toast(
    "Transmissão encerrada."
  );
}

/* =========================================================
   MICROFONE
========================================================= */

async function toggleMic() {
  if (mutedByAdmin) {
    toast(
      "O administrador desativou os microfones."
    );

    return;
  }

  if (!micOn) {
    await enableMicrophone();
  } else {
    disableMyMicrophone();
  }
}

async function enableMicrophone() {
  try {
    const stream =
      await navigator.mediaDevices.getUserMedia(
        {
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        }
      );

    localMic =
      stream.getAudioTracks()[0];

    localMic.enabled = true;

    micOn = true;

    for (const [
      peerId,
      state
    ] of peers) {
      const sender =
        state.pc
          .getSenders()
          .find(
            (s) =>
              s.track?.kind === "audio"
          );

      if (sender) {
        await sender.replaceTrack(
          localMic
        );
      } else {
        state.pc.addTrack(
          localMic,
          stream
        );

        const offer =
          await state.pc.createOffer();

        await state.pc.setLocalDescription(
          offer
        );

        sendSignal(peerId, {
          sdp: state.pc.localDescription
        });
      }
    }

    socket?.send(
      JSON.stringify({
        type: "mute",
        value: false
      })
    );

    updateMicButton();

    toast(
      "Microfone ligado."
    );
  } catch (error) {
    console.error(error);

    toast(
      "Não foi possível acessar o microfone."
    );
  }
}

function disableMyMicrophone() {
  micOn = false;

  if (localMic) {
    try {
      localMic.stop();
    } catch {}

    localMic = null;
  }

  for (const state of peers.values()) {
    const sender =
      state.pc
        .getSenders()
        .find(
          (s) =>
            s.track?.kind === "audio"
        );

    if (sender) {
      sender
        .replaceTrack(null)
        .catch(() => {});
    }
  }

  socket?.send(
    JSON.stringify({
      type: "mute",
      value: true
    })
  );

  updateMicButton();
}

function updateMicButton() {
  const button = $("#micBtn");

  if (!button) return;

  if (mutedByAdmin) {
    button.innerHTML =
      "<span>🔇</span> Microfone bloqueado";

    return;
  }

  if (micOn) {
    button.innerHTML =
      "<span>🎙️</span> Microfone ligado";
  } else {
    button.innerHTML =
      "<span>🎙️</span> Microfone";
  }
}

/* =========================================================
   ADMINISTRADOR
========================================================= */

function updateAdminInterface() {
  let menu =
    $("#adminPanel");

  /*
   * Se não existe no HTML,
   * criamos automaticamente.
   */
  if (!menu && isHost) {
    createAdminPanel();
  }

  if (!isHost) {
    $("#adminPanel")
      ?.classList.add("hidden");

    return;
  }

  $("#adminPanel")
    ?.classList.remove("hidden");
}

function createAdminPanel() {
  const panel =
    document.createElement("div");

  panel.id = "adminPanel";

  panel.className =
    "admin-panel";

  panel.innerHTML = `
    <div class="admin-title">
      <span>👑</span>
      Administração da sala
    </div>

    <button
      id="muteAllBtn"
      class="admin-action"
    >
      🔇 Mutar todos
    </button>

    <button
      id="unlockAllBtn"
      class="admin-action"
    >
      🎙️ Liberar microfones
    </button>

    <div class="admin-info">
      Você é o administrador desta sala.
    </div>
  `;

  document.body.appendChild(panel);

  $("#muteAllBtn").onclick =
    () => muteAll(true);

  $("#unlockAllBtn").onclick =
    () => muteAll(false);
}

function muteAll(value) {
  if (!isHost) {
    toast(
      "Somente o administrador pode fazer isso."
    );

    return;
  }

  socket?.send(
    JSON.stringify({
      type: "mute-all",
      value
    })
  );

  toast(
    value
      ? "Microfones mutados."
      : "Microfones liberados."
  );
}

/* =========================================================
   PARTICIPANTES
========================================================= */

function participantHTML(p) {
  const initial =
    (p.name || "?")
      .slice(0, 1)
      .toUpperCase();

  const hostBadge =
    p.peerId === getCurrentHost()
      ? `<span class="host-badge">👑</span>`
      : "";

  const muteBadge =
    p.muted
      ? `<span class="mute-badge">🔇</span>`
      : "";

  return `
    <div
      class="participant"
      data-participant="${p.peerId}"
    >

      <div class="avatar">
        ${initial}
      </div>

      <div class="pname">
        ${escapeHtml(p.name)}

        ${
          p.peerId === myId
            ? " <small>(você)</small>"
            : ""
        }
      </div>

      ${hostBadge}
      ${muteBadge}

      ${
        p.sharing
          ? `<div
              class="sharing-dot"
              title="Transmitindo"
            ></div>`
          : ""
      }

    </div>
  `;
}

function getCurrentHost() {
  return window.__hostId || myId;
}

function renderParticipants(list) {
  $("#participants").innerHTML =
    list.map(participantHTML).join("");

  $("#count").textContent =
    list.length;
}

function addParticipant(participant) {
  const exists =
    document.querySelector(
      `[data-participant="${participant.peerId}"]`
    );

  if (!exists) {
    $("#participants")
      .insertAdjacentHTML(
        "beforeend",
        participantHTML(participant)
      );
  }

  renderParticipantsFromDOM();
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
    addParticipant(participant);
  }

  renderParticipantsFromDOM();
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

/* =========================================================
   CHAT
========================================================= */

function addChat(
  from,
  text,
  mine
) {
  const element =
    document.createElement("div");

  element.className = "message";

  element.innerHTML = `
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

  $("#chatMessages")
    ?.appendChild(element);

  if ($("#chatMessages")) {
    $("#chatMessages").scrollTop =
      $("#chatMessages").scrollHeight;
  }
}

/* =========================================================
   CONVITE
========================================================= */

function copyInvite() {
  const url =
    `${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}`;

  navigator.clipboard
    ?.writeText(url)
    .then(
      () => toast(
        "Link da sala copiado!"
      ),
      () => toast(url)
    );
}

/* =========================================================
   SENHA
========================================================= */

function showPasswordModal() {
  let modal =
    $("#passwordModal");

  if (!modal) {
    modal =
      document.createElement("div");

    modal.id =
      "passwordModal";

    modal.className =
      "password-modal";

    modal.innerHTML = `
      <div class="password-box">

        <div class="password-icon">
          🔐
        </div>

        <h2>Sala protegida</h2>

        <p>
          Digite a senha para entrar.
        </p>

        <input
          id="roomPassword"
          type="password"
          placeholder="Senha da sala"
          autocomplete="off"
        >

        <button
          id="passwordEnter"
          class="primary"
        >
          Entrar na sala
        </button>

      </div>
    `;

    document.body.appendChild(modal);

    $("#passwordEnter").onclick =
      () => {
        const password =
          $("#roomPassword").value;

        if (!password) {
          toast(
            "Digite a senha."
          );

          return;
        }

        modal.remove();

        connect(password);
      };

    $("#roomPassword").onkeydown =
      (event) => {
        if (
          event.key === "Enter"
        ) {
          $("#passwordEnter").click();
        }
      };
  }

  modal.classList.remove(
    "hidden"
  );
}

/* =========================================================
   ENTRAR NA SALA
========================================================= */

function enterRoom() {
  myName =
    (
      $("#nameHome")?.value ||
      "Convidado"
    )
      .trim()
      .slice(0, 30) ||
    "Convidado";

  roomId =
    normalizeRoom(
      roomId ||
      $("#roomInput")?.value
    );

  if (!roomId) {
    roomId =
      randomRoom();
  }

  history.replaceState(
    {},
    "",
    `?room=${encodeURIComponent(roomId)}`
  );

  $("#home")
    ?.classList.add("hidden");

  $("#room")
    ?.classList.remove("hidden");

  connect();
}

/* =========================================================
   BOTÕES
========================================================= */

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
      disableMyMicrophone();
      socket?.close();
    } catch {}

    location.href =
      location.pathname;
  }
);

/* CHAT */

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
      !socket ||
      socket.readyState !==
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

/* ENTER NO CÓDIGO */

$("#roomInput")?.addEventListener(
  "keydown",
  (event) => {
    if (
      event.key === "Enter"
    ) {
      $("#joinBtn")?.click();
    }
  }
);

/* =========================================================
   BOTÕES DE TRANSMISSÃO
========================================================= */

function updateShareButtons() {
  const shareBtn =
    $("#shareBtn");

  const centerBtn =
    $("#shareCenterBtn");

  const stopBtn =
    $("#stopShareBtn");

  if (sharing) {
    shareBtn
      ?.classList.add("hidden");

    centerBtn
      ?.classList.add("hidden");

    stopBtn
      ?.classList.remove("hidden");
  } else {
    shareBtn
      ?.classList.remove("hidden");

    centerBtn
      ?.classList.remove("hidden");

    stopBtn
      ?.classList.add("hidden");
  }
}

/* =========================================================
   ESTADO VAZIO
========================================================= */

function hideEmpty() {
  $("#emptyState")
    ?.classList.add("hidden");
}

function showEmpty() {
  if (
    $("#videos") &&
    !$("#videos").children.length
  ) {
    $("#emptyState")
      ?.classList.remove("hidden");
  }
}

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

if (roomId) {
  $("#home")
    ?.classList.remove("hidden");

  if ($("#roomInput")) {
    $("#roomInput").value =
      roomId;
  }
}

/* =========================================================
   CSS EXTRA AUTOMÁTICO
========================================================= */

const extraStyle =
  document.createElement("style");

extraStyle.textContent = `
  .admin-panel {
    position: fixed;
    right: 25px;
    top: 85px;
    z-index: 999;
    width: 260px;
    padding: 18px;
    border-radius: 18px;
    background: rgba(13, 10, 25, .96);
    border: 1px solid rgba(139, 92, 246, .35);
    box-shadow: 0 20px 60px rgba(0,0,0,.45);
    backdrop-filter: blur(20px);
  }

  .admin-title {
    display: flex;
    align-items: center;
    gap: 9px;
    font-weight: 800;
    margin-bottom: 15px;
  }

  .admin-action {
    width: 100%;
    padding: 11px;
    margin-top: 8px;
    border-radius: 12px;
    border: 1px solid rgba(139, 92, 246, .25);
    background: #171225;
    color: white;
    cursor: pointer;
  }

  .admin-action:hover {
    background: #21183a;
  }

  .admin-info {
    margin-top: 12px;
    color: #9f98ad;
    font-size: 11px;
    line-height: 1.4;
  }

  .host-badge,
  .mute-badge {
    font-size: 11px;
  }

  .video-card {
    position: relative;
  }

  .video-audio-button {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    padding: 12px 18px;
    border: 0;
    border-radius: 12px;
    background: rgba(120, 70, 255, .95);
    color: white;
    font-weight: 700;
    cursor: pointer;
  }

  .local-video {
    border: 1px solid rgba(139, 92, 246, .45);
  }

  .password-modal {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,.75);
    backdrop-filter: blur(12px);
  }

  .password-box {
    width: min(400px, calc(100% - 30px));
    padding: 30px;
    border-radius: 24px;
    background: #100d18;
    border: 1px solid rgba(139, 92, 246, .3);
    text-align: center;
    box-shadow: 0 30px 100px rgba(0,0,0,.6);
  }

  .password-icon {
    font-size: 42px;
    margin-bottom: 10px;
  }

  .password-box h2 {
    margin: 0 0 8px;
  }

  .password-box p {
    color: #9d96a8;
    font-size: 13px;
    margin-bottom: 20px;
  }

  .password-box input {
    width: 100%;
    padding: 13px;
    border-radius: 12px;
    border: 1px solid #312941;
    background: #08070c;
    color: white;
    outline: none;
    margin-bottom: 10px;
  }

  .password-box button {
    width: 100%;
  }
`;

document.head.appendChild(
  extraStyle
);
