/* =========================================================
   HYPE ROLEPLAY
   Compartilhamento de tela - WebRTC
   Versão corrigida
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

let localScreenStream = null;
let localMicStream = null;

let micEnabled = false;

const peers = new Map();
const participants = new Map();

/*
 * Guarda os streams recebidos de cada participante.
 *
 * peerId => {
 *   stream: MediaStream,
 *   card: HTMLElement,
 *   video: HTMLVideoElement
 * }
 */
const remoteStreams = new Map();


const reconnectState = {
    attempts: 0,
    timer: null
};


/* =========================================================
   DETECTAR CELULAR
========================================================= */

function detectMobile() {

    const ua = navigator.userAgent || "";

    return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

isMobile = detectMobile();


/* =========================================================
   TOAST
========================================================= */

let toastTimer = null;

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
   SALA
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

    const room =
        generateRoom();

    localStorage.setItem(
        "hype_name",
        name
    );

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

    localStorage.setItem(
        "hype_name",
        name
    );

    enterRoom(room, name);

});


roomInput?.addEventListener(
    "keydown",
    event => {

        if (event.key === "Enter") {
            joinBtn?.click();
        }

    }
);


nameHome?.addEventListener(
    "keydown",
    event => {

        if (event.key === "Enter") {
            createBtn?.click();
        }

    }
);


/* =========================================================
   ENTRAR NA SALA
========================================================= */

function enterRoom(room, name) {

    roomId =
        room
            .replace(
                /[^a-zA-Z0-9_-]/g,
                ""
            )
            .slice(0, 32);

    myName =
        name
            .trim()
            .slice(0, 30);

    if (!roomId) {

        toast("Código de sala inválido.");

        return;
    }

    if (!myName) {

        toast("Digite seu nome.");

        return;
    }

    updateUrl(roomId);

    home?.classList.add("hidden");

    roomPage?.classList.remove("hidden");

    roomCodeEl.textContent =
        roomId;

    roomStatus.textContent =
        "Conectando...";

    connectSocket();
}


/* =========================================================
   WEBSOCKET
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

    roomStatus.textContent =
        "Conectando...";

    socket =
        new WebSocket(
            websocketUrl()
        );

    socket.addEventListener(
        "open",
        () => {

            reconnectState.attempts = 0;

            roomStatus.textContent =
                "Conectado";

            send({
                type: "join",
                room: roomId,
                name: myName,
                mobile: isMobile
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

            handleMessage(message);
        }
    );

    socket.addEventListener(
        "close",
        () => {

            roomStatus.textContent =
                "Desconectado";

            scheduleReconnect();
        }
    );

    socket.addEventListener(
        "error",
        () => {

            roomStatus.textContent =
                "Erro de conexão";
        }
    );
}


function scheduleReconnect() {

    if (reconnectState.timer) {
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


function send(message) {

    if (
        !socket ||
        socket.readyState !== WebSocket.OPEN
    ) {

        toast(
            "Sem conexão com a sala."
        );

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

            addParticipant(
                msg.participant
            );

            /*
             * Quem já está na sala cria a conexão.
             * O novo participante responderá.
             */

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
                () => leaveRoom(),
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

    myPeerId =
        msg.peerId;

    isAdmin =
        Boolean(msg.admin);

    roomId =
        msg.room;

    roomCodeEl.textContent =
        roomId;

    refreshParticipants(
        msg.participants || []
    );

    updateAdminInterface();


    /*
     * Criar conexões com quem já estava.
     */

    for (
        const participant
        of msg.participants || []
    ) {

        if (
            participant.peerId ===
            myPeerId
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
            "Modo espectador: no celular você pode assistir às transmissões."
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

    if (!participant) {
        return;
    }

    participants.set(
        participant.peerId,
        participant
    );

    renderParticipants();
}


function updateParticipant(participant) {

    if (!participant) {
        return;
    }

    participants.set(
        participant.peerId,
        participant
    );

    renderParticipants();
}


function removeParticipant(peerId) {

    participants.delete(peerId);

    const peer =
        peers.get(peerId);

    if (peer) {

        try {
            peer.close();
        } catch {}

        peers.delete(peerId);
    }

    removeRemoteStream(peerId);

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

    for (
        const participant
        of participants.values()
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
         * Botões do administrador.
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
                participant.muted
                    ? "Ativar microfone"
                    : "Mutar usuário";

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
            type:
                "admin-mute-all"
        });

        toast(
            "Silenciando participantes..."
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


    peers.set(
        peerId,
        pc
    );


    /*
     * Microfone existente.
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
     * Tela existente.
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
     * ICE.
     */

    pc.onicecandidate =
        event => {

            if (!event.candidate) {
                return;
            }

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

        };


    /*
     * TRACK
     *
     * Importante:
     * áudio e vídeo podem chegar
     * como tracks separados.
     *
     * Por isso não usamos apenas
     * event.streams[0].
     */

    pc.ontrack =
        event => {

            handleRemoteTrack(
                peerId,
                event.track,
                event.streams
            );

        };


    pc.onconnectionstatechange =
        () => {

            const state =
                pc.connectionState;

            console.log(
                `WebRTC ${peerId}:`,
                state
            );


            if (state === "failed") {

                try {
                    pc.restartIce();
                } catch {}

            }


            if (state === "closed") {

                removeRemoteStream(
                    peerId
                );

            }

        };


    /*
     * O iniciador cria a oferta.
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
   TRACK REMOTA
========================================================= */

function handleRemoteTrack(
    peerId,
    track,
    streams
) {

    let data =
        remoteStreams.get(peerId);


    if (!data) {

        const stream =
            new MediaStream();

        data = {

            stream,

            card: null,

            video: null

        };

        remoteStreams.set(
            peerId,
            data
        );
    }


    /*
     * Não adicionar duas vezes
     * a mesma track.
     */

    const already =
        data.stream
            .getTracks()
            .some(
                existing =>
                    existing.id === track.id
            );


    if (!already) {

        data.stream.addTrack(track);
    }


    /*
     * Se a track terminar,
     * removemos somente aquela track.
     */

    track.addEventListener(
        "ended",
        () => {

            try {

                data.stream.removeTrack(
                    track
                );

            } catch {}

        }
    );


    showRemoteVideo(
        peerId,
        data.stream
    );
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
   RENEGOCIAR
========================================================= */

async function renegotiate(
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
            "Erro na renegociação:",
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

    let card =
        document.getElementById(
            `video-${peerId}`
        );


    let video;


    if (!card) {

        card =
            document.createElement(
                "div"
            );

        card.className =
            "video-card";

        card.id =
            `video-${peerId}`;


        video =
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


        /*
         * Botão para ativar áudio.
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
            "🔊 Ativar áudio";


        audioButton.addEventListener(
            "click",
            event => {

                event.stopPropagation();

                video.muted =
                    false;

                video.volume =
                    1;

                video.play()
                    .then(() => {

                        audioButton.remove();

                    })
                    .catch(() => {});

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


        /*
         * Tenta reproduzir automaticamente.
         */

        video.play()
            .then(() => {

                /*
                 * Se o navegador permitiu
                 * áudio, remove o botão.
                 */

                if (!video.muted) {

                    audioButton.remove();
                }

            })
            .catch(() => {

                card.classList.add(
                    "audio-locked"
                );

            });


        /*
         * Clique no card ativa áudio.
         */

        card.addEventListener(
            "click",
            event => {

                if (
                    event.target ===
                    audioButton
                ) {
                    return;
                }

                video.muted =
                    false;

                video.volume =
                    1;

                video.play()
                    .catch(() => {});

            }
        );

    } else {

        video =
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


    const data =
        remoteStreams.get(
            peerId
        );


    if (data) {

        data.card =
            card;

        data.video =
            video;
    }


    emptyState?.classList.add(
        "hidden"
    );
}


/* =========================================================
   REMOVER VÍDEO REMOTO
========================================================= */

function removeRemoteStream(
    peerId
) {

    const data =
        remoteStreams.get(
            peerId
        );


    if (data) {

        try {

            data.stream
                .getTracks()
                .forEach(
                    track => {
                        try {
                            track.stop();
                        } catch {}
                    }
                );

        } catch {}

    }


    remoteStreams.delete(
        peerId
    );


    removeVideo(
        peerId
    );
}


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

            try {
                video.pause();
            } catch {}

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
   MINHA PRÓPRIA TRANSMISSÃO
========================================================= */

function showLocalPreview(
    stream
) {

    let card =
        document.getElementById(
            "video-local"
        );


    if (!card) {

        card =
            document.createElement(
                "div"
            );

        card.className =
            "video-card local-video-card";

        card.id =
            "video-local";


        const video =
            document.createElement(
                "video"
            );

        video.autoplay =
            true;

        video.muted =
            true;

        video.playsInline =
            true;

        video.controls =
            false;


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
            `${myName} • Você`;


        card.appendChild(
            name
        );


        const badge =
            document.createElement(
                "div"
            );

        badge.className =
            "local-live-badge";

        badge.textContent =
            "🔴 AO VIVO";


        card.appendChild(
            badge
        );


        videos.prepend(
            card
        );

    } else {

        const video =
            card.querySelector(
                "video"
            );


        if (video) {

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
   REMOVER MINHA PRÉVIA
========================================================= */

function removeLocalPreview() {

    const card =
        document.getElementById(
            "video-local"
        );


    if (card) {

        const video =
            card.querySelector(
                "video"
            );


        if (video) {

            try {
                video.pause();
            } catch {}

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

        /*
         * Solicita vídeo + áudio.
         *
         * O navegador só fornecerá áudio
         * se a fonte selecionada permitir.
         */

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
         * MOSTRA A PRÓPRIA TELA
         */

        showLocalPreview(
            stream
        );


        /*
         * Quando o usuário encerra
         * pelo botão nativo do navegador.
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
         * Adiciona a tela às conexões
         * existentes.
         */

        for (
            const [
                peerId,
                pc
            ]
            of peers
        ) {

            /*
             * Evita duplicar tracks.
             */

            const existingSenders =
                pc.getSenders();


            for (
                const track
                of stream.getTracks()
            ) {

                const alreadySending =
                    existingSenders.some(
                        sender =>
                            sender.track &&
                            sender.track.id ===
                            track.id
                    );


                if (!alreadySending) {

                    pc.addTrack(
                        track,
                        stream
                    );

                }

            }


            await renegotiate(
                peerId,
                pc
            );

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


        const audioTracks =
            stream.getAudioTracks();


        if (audioTracks.length > 0) {

            toast(
                "Tela compartilhada com áudio."
            );

        } else {

            toast(
                "Tela compartilhada. Esta fonte não forneceu áudio."
            );

        }

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
     * Remove SOMENTE vídeo da tela.
     *
     * Não remove microfone.
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


    /*
     * Remove nossa prévia.
     */

    removeLocalPreview();


    if (notifyServer) {

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
            "No celular o microfone está desativado."
        );

        return;
    }


    try {

        /*
         * Primeiro uso:
         * solicitar microfone.
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
             * Adicionar microfone
             * aos peers.
             */

            for (
                const [
                    peerId,
                    pc
                ]
                of peers
            ) {

                const existing =
                    pc.getSenders();


                for (
                    const track
                    of localMicStream.getAudioTracks()
                ) {

                    const alreadySending =
                        existing.some(
                            sender =>
                                sender.track &&
                                sender.track.id ===
                                track.id
                        );


                    if (!alreadySending) {

                        pc.addTrack(
                            track,
                            localMicStream
                        );

                    }

                }


                await renegotiate(
                    peerId,
                    pc
                );

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

            type:
                "mic",

            muted:
                !micEnabled

        });


    } catch (error) {

        console.error(
            error
        );


        if (
            error.name ===
            "NotAllowedError"
        ) {

            toast(
                "Permissão do microfone foi bloqueada."
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

function setLocalMute(
    muted
) {

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
        const pc
        of peers.values()
    ) {

        try {
            pc.close();
        } catch {}

    }


    peers.clear();


    for (
        const peerId
        of remoteStreams.keys()
    ) {

        removeRemoteStream(
            peerId
        );

    }


    remoteStreams.clear();


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

        stopScreenShare(true);

    }
);


micBtn?.addEventListener(
    "click",
    toggleMicrophone
);


/* =========================================================
   QUANDO A PÁGINA ABRE
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
   MOBILE
========================================================= */

if (isMobile) {

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


/* =========================================================
   DEBUG
========================================================= */

console.log(
    "Hype Roleplay - WebRTC carregado.",
    {
        mobile: isMobile
    }
);
