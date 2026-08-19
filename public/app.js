const $ = (selector) => document.querySelector(selector);

const params = new URLSearchParams(location.search);

let roomId = params.get("room") || "";
let myId = null;
let myName = "";
let socket = null;

let isAdmin = false;
let deviceType = "desktop";

let sharing = false;
let micOn = false;

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
  }, 2800);
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
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char])
  );
}


/* =========================================================
   DETECTAR CELULAR
========================================================= */

function detectDevice() {
  const ua = navigator.userAgent.toLowerCase();

  if (
    /android|iphone|ipad|ipod|mobile/.test(ua)
  ) {
    return "mobile";
  }

  return "desktop";
}


/* =========================================================
   CONEXÃO
========================================================= */

function connect() {

  const protocol =
    location.protocol === "https:"
      ? "wss"
      : "ws";

  socket = new WebSocket(
    `${protocol}://${location.host}`
  );


  socket.onopen = () => {

    socket.send(JSON.stringify({
      type: "join",
      room: roomId,
      name: myName,
      userAgent: navigator.userAgent
    }));

    if ($("#roomStatus")) {
      $("#roomStatus").textContent = "Conectado";
    }
  };


  socket.onclose = () => {

    if ($("#roomStatus")) {
      $("#roomStatus").textContent = "Desconectado";
    }

    toast("A conexão com a sala foi encerrada.");
  };


  socket.onerror = () => {
    toast("Não foi possível conectar ao servidor.");
  };


  socket.onmessage = async event => {

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


    /* ENTROU */

    if (msg.type === "joined") {

      myId = msg.peerId;
      isAdmin = !!msg.isAdmin;

      deviceType =
        msg.canShare === false
          ? "mobile"
          : "desktop";


      if ($("#roomCode")) {
        $("#roomCode").textContent = msg.room;
      }


      renderParticipants(msg.participants);

      updateAdminInterface();


      /*
       * CELULAR NÃO INICIA WEBRTC
       * apenas recebe.
       */

      if (deviceType === "mobile") {
        toast("Você entrou como espectador.");
        return;
      }


      /*
       * PC cria conexão com quem já estava.
       */

      for (const participant of msg.participants) {

        if (participant.peerId === myId) {
          continue;
        }

        const pc = createPeer(
          participant.peerId,
          participant.name,
          true
        );

        try {

          const offer =
            await pc.createOffer();

          await pc.setLocalDescription(offer);

          sendSignal(
            participant.peerId,
            {
              sdp: pc.localDescription
            }
          );

        } catch (error) {

          console.error(
            "Erro criando oferta:",
            error
          );
        }
      }

      return;
    }


    /* NOVO PARTICIPANTE */

    if (msg.type === "participant-joined") {

      addParticipant(msg.participant);

      return;
    }


    /* LISTA COMPLETA */

    if (msg.type === "participants") {

      renderParticipants(msg.participants);

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

      return;
    }


    /* EXPULSO */

    if (msg.type === "kicked") {

      toast(msg.message);

      setTimeout(() => {
        location.href = location.pathname;
      }, 1200);

      return;
    }


    if (msg.type === "force-disconnect") {

      try {
        socket.close();
      } catch {}

      location.href = location.pathname;

      return;
    }


    /* ADM PROMOVIDO */

    if (msg.type === "admin-promoted") {

      isAdmin = true;

      updateAdminInterface();

      toast("Você agora é o administrador da sala.");

      return;
    }


    /* ADM MANDOU ALTERAR MICROFONE */

    if (msg.type === "force-mic") {

      const value = !!msg.value;

      if (value) {
        await enableMic();
      } else {
        disableMic();
      }

      return;
    }
  };
}


/* =========================================================
   SIGNALING
========================================================= */

function sendSignal(to, signal) {

  if (!socket || socket.readyState !== 1) {
    return;
  }

  socket.send(JSON.stringify({
    type: "signal",
    to,
    signal
  }));
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
    candidateQueue: []
  };


  peers.set(peerId, state);


  pc.onicecandidate = event => {

    if (event.candidate) {

      sendSignal(
        peerId,
        {
          candidate: event.candidate
        }
      );
    }
  };


  pc.ontrack = event => {

    const stream =
      event.streams[0];

    if (!stream) {
      return;
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

    const stateName =
      pc.connectionState;

    if (
      stateName === "failed"
    ) {

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
          pc.connectionState ===
          "disconnected"
        ) {
          removePeer(peerId);
        }

      }, 4000);
    }
  };


  /*
   * ADICIONAR TELA LOCAL
   */

  if (localScreen) {

    for (
      const track
      of localScreen.getTracks()
    ) {

      pc.addTrack(
        track,
        localScreen
      );
    }
  }


  /*
   * ADICIONAR MICROFONE
   */

  if (localMic) {

    for (
      const track
      of localMic.getTracks()
    ) {

      pc.addTrack(
        track,
        localMic
      );
    }
  }


  return pc;
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
    fromName,
    false
  );


  const state =
    peers.get(from);


  try {

    if (signal.sdp) {

      await pc.setRemoteDescription(
        signal.sdp
      );


      while (
        state.candidateQueue.length
      ) {

        await pc.addIceCandidate(
          state.candidateQueue.shift()
        );
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
            sdp:
              pc.localDescription
          }
        );
      }

      return;
    }


    if (signal.candidate) {

      if (
        pc.remoteDescription
      ) {

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
   VÍDEOS
========================================================= */

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
        controls
      ></video>

      <div class="video-name"></div>
    `;

    $("#videos")
      ?.appendChild(card);
  }


  const video =
    card.querySelector("video");


  if (
    video.srcObject !== stream
  ) {

    video.srcObject = stream;
  }


  video.play().catch(() => {});


  const nameEl =
    card.querySelector(
      ".video-name"
    );


  if (nameEl) {

    nameEl.textContent =
      `${name} · transmitindo`;
  }
}


/* =========================================================
   COMPARTILHAR TELA
========================================================= */

async function startShare() {

  /*
   * CELULAR NÃO TRANSMITE
   */

  if (deviceType === "mobile") {

    toast(
      "No celular você pode apenas assistir."
    );

    return;
  }


  if (
    !navigator.mediaDevices?.getDisplayMedia
  ) {

    toast(
      "Seu navegador não suporta compartilhamento de tela."
    );

    return;
  }


  try {

    localScreen =
      await navigator.mediaDevices.getDisplayMedia({

        video: {
          cursor: "always",
          frameRate: {
            ideal: 30,
            max: 60
          }
        },

        /*
         * O navegador mostra a opção
         * de áudio da tela/janela.
         */
        audio: true
      });


    sharing = true;


    updateShareButtons();


    /*
     * Para cada participante
     */

    for (
      const [peerId, state]
      of peers
    ) {

      const videoTrack =
        localScreen
          .getVideoTracks()[0];


      const videoSender =
        state.pc
          .getSenders()
          .find(
            sender =>
              sender.track?.kind ===
              "video"
          );


      if (videoSender) {

        await videoSender
          .replaceTrack(
            videoTrack
          );

      } else {

        state.pc.addTrack(
          videoTrack,
          localScreen
        );


        /*
         * Áudio da tela
         */

        for (
          const audioTrack
          of localScreen
            .getAudioTracks()
        ) {

          const audioSender =
            state.pc
              .getSenders()
              .find(
                sender =>
                  sender.track?.kind ===
                  "audio"
              );


          if (!audioSender) {

            state.pc.addTrack(
              audioTrack,
              localScreen
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
            sdp:
              state.pc.localDescription
          }
        );
      }
    }


    const screenTrack =
      localScreen
        .getVideoTracks()[0];


    if (screenTrack) {

      screenTrack.onended =
        stopShare;
    }


    socket?.send(
      JSON.stringify({
        type: "sharing",
        value: true
      })
    );


    updateParticipant({
      peerId: myId,
      name: myName,
      sharing: true,
      micOn,
      isAdmin,
      device: deviceType
    });


    toast(
      "Sua tela está sendo transmitida."
    );

  } catch (error) {

    console.error(error);

    if (
      error.name !==
        "AbortError" &&
      error.name !==
        "NotAllowedError"
    ) {

      toast(
        "Não foi possível iniciar a transmissão."
      );
    }
  }
}


function stopShare() {

  if (!localScreen) {
    return;
  }


  localScreen
    .getTracks()
    .forEach(
      track => track.stop()
    );


  localScreen = null;
  sharing = false;


  updateShareButtons();


  socket?.send(
    JSON.stringify({
      type: "sharing",
      value: false
    })
  );


  for (
    const state
    of peers.values()
  ) {

    const videoSender =
      state.pc
        .getSenders()
        .find(
          sender =>
            sender.track?.kind ===
            "video"
        );


    if (videoSender) {

      videoSender
        .replaceTrack(null)
        .catch(() => {});
    }
  }


  toast(
    "Transmissão encerrada."
  );
}


/* =========================================================
   MICROFONE
========================================================= */

async function enableMic() {

  try {

    if (!localMic) {

      localMic =
        await navigator.mediaDevices
          .getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          });
    }


    const track =
      localMic
        .getAudioTracks()[0];


    if (!track) {
      return;
    }


    track.enabled = true;
    micOn = true;


    for (
      const [peerId, state]
      of peers
    ) {

      const sender =
        state.pc
          .getSenders()
          .find(
            s =>
              s.track?.kind ===
              "audio"
          );


      if (sender) {

        await sender.replaceTrack(
          track
        );

      } else {

        state.pc.addTrack(
          track,
          localMic
        );


        const offer =
          await state.pc.createOffer();

        await state.pc.setLocalDescription(
          offer
        );


        sendSignal(
          peerId,
          {
            sdp:
              state.pc.localDescription
          }
        );
      }
    }


    updateMicButton();


    socket?.send(
      JSON.stringify({
        type: "mic",
        value: true
      })
    );

  } catch (error) {

    console.error(error);

    toast(
      "Não foi possível acessar o microfone."
    );
  }
}


function disableMic() {

  micOn = false;


  if (localMic) {

    localMic
      .getAudioTracks()
      .forEach(
        track =>
          track.enabled = false
      );
  }


  for (
    const state
    of peers.values()
  ) {

    const sender =
      state.pc
        .getSenders()
        .find(
          s =>
            s.track?.kind ===
            "audio"
        );


    if (sender) {

      sender
        .replaceTrack(null)
        .catch(() => {});
    }
  }


  updateMicButton();


  socket?.send(
    JSON.stringify({
      type: "mic",
      value: false
    })
  );
}


async function toggleMic() {

  if (deviceType === "mobile") {

    toast(
      "No celular o microfone está desativado."
    );

    return;
  }


  if (micOn) {
    disableMic();
  } else {
    await enableMic();
  }
}


/* =========================================================
   INTERFACE
========================================================= */

function updateShareButtons() {

  const shareButtons = [
    $("#shareBtn"),
    $("#shareCenterBtn")
  ];


  for (
    const button
    of shareButtons
  ) {

    if (!button) continue;

    if (deviceType === "mobile") {

      button.classList.add(
        "hidden"
      );

    } else {

      button.classList.toggle(
        "hidden",
        sharing
      );
    }
  }


  const stop =
    $("#stopShareBtn");


  if (stop) {

    stop.classList.toggle(
      "hidden",
      !sharing
    );
  }
}


function updateMicButton() {

  const button =
    $("#micBtn");

  if (!button) return;


  if (micOn) {

    button.innerHTML =
      "<span>🎙️</span> Microfone ligado";

  } else {

    button.innerHTML =
      "<span>🎙️</span> Microfone";
  }
}


function updateAdminInterface() {

  /*
   * Menu do administrador
   */

  const adminMenu =
    $("#adminPanel");


  if (!adminMenu) {
    return;
  }


  if (isAdmin) {

    adminMenu.classList.remove(
      "hidden"
    );

  } else {

    adminMenu.classList.add(
      "hidden"
    );
  }
}


/* =========================================================
   PARTICIPANTES
========================================================= */

function participantHTML(p) {

  const initial =
    (p.name || "?")
      .slice(0, 1)
      .toUpperCase();


  const adminBadge =
    p.isAdmin
      ? `<span class="admin-badge">ADM</span>`
      : "";


  const deviceBadge =
    p.device === "mobile"
      ? `<span class="device-badge">📱</span>`
      : `<span class="device-badge">💻</span>`;


  const sharingBadge =
    p.sharing
      ? `<span class="sharing-dot" title="Transmitindo"></span>`
      : "";


  let adminControls = "";


  /*
   * O administrador não pode
   * controlar a si próprio.
   */

  if (
    isAdmin &&
    p.peerId !== myId
  ) {

    adminControls = `
      <div class="participant-actions">

        <button
          class="mini-btn"
          onclick="adminMute('${p.peerId}')"
          title="Mutar microfone"
        >
          🔇
        </button>

        <button
          class="mini-btn kick-btn"
          onclick="kickUser('${p.peerId}')"
          title="Expulsar"
        >
          ✕
        </button>

      </div>
    `;
  }


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

        ${p.peerId === myId
          ? " (você)"
          : ""}

        ${adminBadge}

      </div>

      ${deviceBadge}

      ${
        p.micOn
          ? `<span class="mic-status">🎙️</span>`
          : `<span class="mic-status muted">🔇</span>`
      }

      ${sharingBadge}

      ${adminControls}

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


  const count =
    $("#count");

  if (count) {
    count.textContent =
      list.length;
  }
}


function addParticipant(p) {

  const exists =
    document.querySelector(
      `[data-participant="${p.peerId}"]`
    );


  if (!exists) {

    $("#participants")
      ?.insertAdjacentHTML(
        "beforeend",
        participantHTML(p)
      );
  }


  renderParticipantsFromDOM();
}


function updateParticipant(p) {

  const old =
    document.querySelector(
      `[data-participant="${p.peerId}"]`
    );


  if (old) {

    old.outerHTML =
      participantHTML(p);

  } else {

    addParticipant(p);
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
   ADMIN
========================================================= */

function adminMute(peerId) {

  if (!isAdmin) {
    return;
  }


  socket?.send(
    JSON.stringify({
      type: "admin-mic",
      peerId,
      value: false
    })
  );


  toast(
    "Microfone do usuário mutado."
  );
}


function kickUser(peerId) {

  if (!isAdmin) {
    return;
  }


  const participant =
    document.querySelector(
      `[data-participant="${peerId}"]`
    );


  const name =
    participant
      ?.querySelector(".pname")
      ?.textContent
      ?.replace("(você)", "")
      ?.trim() ||
    "este usuário";


  if (
    !confirm(
      `Deseja expulsar ${name} da sala?`
    )
  ) {
    return;
  }


  socket?.send(
    JSON.stringify({
      type: "kick",
      peerId
    })
  );


  toast(
    "Usuário removido da sala."
  );
}


/* =========================================================
   PEER
========================================================= */

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


  document
    .querySelector(
      `[data-participant="${peerId}"]`
    )
    ?.remove();


  renderParticipantsFromDOM();


  if (
    !$("#videos")?.children.length
  ) {

    showEmpty();
  }
}


function hideEmpty() {

  $("#emptyState")
    ?.classList
    .add("hidden");
}


function showEmpty() {

  if (
    !$("#videos")?.children.length
  ) {

    $("#emptyState")
      ?.classList
      .remove("hidden");
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

  const container =
    $("#chatMessages");

  if (!container) {
    return;
  }


  const element =
    document.createElement("div");


  element.className =
    "message";


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


  container.appendChild(
    element
  );


  container.scrollTop =
    container.scrollHeight;
}


/* =========================================================
   CONVITE
========================================================= */

function copyInvite() {

  const url =
    `${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}`;


  if (
    navigator.clipboard
  ) {

    navigator.clipboard
      .writeText(url)
      .then(() => {

        toast(
          "Link da sala copiado!"
        );

      })
      .catch(() => {

        toast(url);
      });

  } else {

    toast(url);
  }
}


/* =========================================================
   ENTRAR NA SALA
========================================================= */

function enterRoom() {

  myName =
    (
      $("#nameHome")
        ?.value ||
      "Convidado"
    )
      .trim()
      .slice(0, 30) ||
    "Convidado";


  roomId =
    normalizeRoom(
      roomId ||
      $("#roomInput")
        ?.value
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
    ?.classList
    .add("hidden");


  $("#room")
    ?.classList
    .remove("hidden");


  connect();
}


/* =========================================================
   EVENTOS
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
      socket?.close();
    } catch {}

    location.href =
      location.pathname;
  }
);


$("#chatForm")?.addEventListener(
  "submit",
  event => {

    event.preventDefault();


    const input =
      $("#chatInput");


    const text =
      input?.value
        ?.trim();


    if (
      !text ||
      socket?.readyState !== 1
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
  event => {

    if (
      event.key === "Enter"
    ) {

      $("#joinBtn")?.click();
    }
  }
);


/* =========================================================
   INICIALIZAÇÃO
========================================================= */

deviceType =
  detectDevice();


if (roomId) {

  $("#home")
    ?.classList
    .remove("hidden");


  if ($("#roomInput")) {

    $("#roomInput").value =
      roomId;
  }
}


updateShareButtons();
updateMicButton();
