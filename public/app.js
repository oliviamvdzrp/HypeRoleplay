```javascript
/* =========================================================
   HYPE ROLEPLAY
   COMPARTILHAMENTO DE TELA - WEBRTC
   VERSÃO CORRIGIDA
========================================================= */

"use strict";

/* =========================================================
   ELEMENTOS
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

/*
 * Tela local.
 */
let localScreenStream = null;

/*
 * Microfone local.
 *
 * Começa desligado.
 */
let localMicStream = null;
let micEnabled = false;

/*
 * PeerConnections.
 *
 * peerId -> RTCPeerConnection
 */
const peers = new Map();

/*
 * Streams remotos.
 *
 * peerId -> MediaStream
 */
const remoteStreams = new Map();

/*
 * Participantes.
 *
 * peerId -> participante
 */
const participants = new Map();

/*
 * Evita negociação simultânea.
 */
const makingOffer = new Map();

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

    try {

        const url =
            new URL(window.location.href);

        return (
            url.searchParams.get("room") || ""
        ).trim();

    } catch {

        return "";

    }
}


function updateUrl(room) {

    try {

        const url =
            new URL(window.location.href);

        url.searchParams.set(
            "room",
            room
        );

        history.replaceState(
            {},
            "",
            url
        );

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
            nameHome?.value.trim();

        if (!name) {

            toast(
                "Digite seu nome primeiro."
            );

            nameHome?.focus();

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
            nameHome?.value.trim();

        const room =
            roomInput?.value
                .trim()
                .toUpperCase();

        if (!name) {

            toast(
                "Digite seu nome primeiro."
            );

            nameHome?.focus();

            return;
        }

        if (!room) {

            toast(
                "Digite o código da sala."
            );

            roomInput?.focus();

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

function enterRoom(
    room,
    name
) {

    roomId =
        String(room)
            .replace(
                /[^a-zA-Z0-9_-]/g,
                ""
            )
            .slice(0, 32);

    myName =
        String(name)
            .trim()
            .slice(0, 30);

    if (!roomId) {

        toast(
            "Código de sala inválido."
        );

        return;
    }

    if (!myName) {

        toast(
            "Digite seu nome."
        );

        return;
    }

    updateUrl(roomId);

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

    /*
     * IMPORTANTE:
     * todo mundo começa mutado.
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
        roomStatus.textContent =
            "Conectando...";
    }

    try {

        socket =
            new WebSocket(
                websocketUrl()
            );

    } catch (error) {

        console.error(error);

        scheduleReconnect();

        return;
    }


    socket.addEventListener(
        "open",
        () => {

            reconnectState.attempts = 0;

            if (roomStatus) {
                roomStatus.textContent =
                    "Conectado";
            }

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
        async event => {

            let message;

            try {

                message =
                    JSON.parse(
                        event.data
                    );

            } catch {

                return;
            }

            await handleMessage(
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
        error => {

            console.error(
                "WebSocket:",
                error
            );

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

    if (!roomId) {
        return;
    }

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

    switch (msg.type) {

        case "joined":

            await handleJoined(msg);

            break;


        case "participant-joined":

            addParticipant(
                msg.participant
            );

            /*
             * A pessoa que entrou deve receber
             * uma conexão dos usuários existentes.
             */
            if (
                msg.participant &&
                msg.participant.peerId !== myPeerId
            ) {

                await ensurePeerConnection(
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
        msg.peerId || "";

    isAdmin =
        Boolean(msg.admin);

    roomId =
        msg.room || roomId;

    if (roomCodeEl) {
        roomCodeEl.textContent =
            roomId;
    }

    /*
     * IMPORTANTE:
     * começamos mutados.
     */
    micEnabled = false;

    if (localMicStream) {

        for (
            const track
            of localMicStream.getTracks()
        ) {

            track.enabled = false;

        }

    }

    updateMicButton();

    refreshParticipants(
        msg.participants || []
    );

    updateAdminInterface();


    /*
     * Criar conexão com quem já estava.
     *
     * Somente o usuário novo cria a oferta.
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

        await ensurePeerConnection(
            participant.peerId,
            true
        );

    }


    if (isMobile) {

        toast(
            "Você entrou como espectador. No celular é possível apenas assistir."
        );

    } else {

        toast(
            "Você entrou na sala. Seu microfone está desligado."
        );

    }
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
            !participant ||
            !participant.peerId
        ) {
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

    /*
     * Atualizar nome do vídeo.
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
}


function removeParticipant(peerId) {

    participants.delete(
        peerId
    );

    closePeer(
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

    participantsEl.innerHTML = "";

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

            dot.title =
                "Compartilhando tela";

            row.appendChild(
                dot
            );

        }


        /*
         * Botões do administrador.
         */
        if (
            isAdmin &&
            participant.peerId !== myPeerId
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
            "Microfones dos participantes foram silenciados."
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
    peerId
) {

    if (peers.has(peerId)) {

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
     * IMPORTANTE:
     *
     * Não adicionamos tracks duplicados.
     */
    addLocalTracksToPeer(
        pc
    );


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
     * Recebendo áudio/tela.
     */
    pc.ontrack =
        event => {

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
             * Evita adicionar a mesma track duas vezes.
             */
            const alreadyExists =
                stream
                    .getTracks()
                    .some(
                        track =>
                            track.id ===
                            event.track.id
                    );


            if (!alreadyExists) {

                stream.addTrack(
                    event.track
                );

            }


            showRemoteVideo(
                peerId,
                stream
            );


            event.track.addEventListener(
                "ended",
                () => {

                    try {
                        stream.removeTrack(
                            event.track
                        );
                    } catch {}

                    if (
                        stream.getTracks()
                            .length === 0
                    ) {

                        removeVideo(
                            peerId
                        );

                    }

                }
            );

        };


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

        };


    return pc;
}


/* =========================================================
   ADICIONAR TRACKS LOCAIS
========================================================= */

function addLocalTracksToPeer(
    pc
) {

    /*
     * Microfone.
     */
    if (localMicStream) {

        for (
            const track
            of localMicStream.getAudioTracks()
        ) {

            const exists =
                pc.getSenders()
                    .some(
                        sender =>
                            sender.track &&
                            sender.track.id ===
                            track.id
                    );

            if (!exists) {

                pc.addTrack(
                    track,
                    localMicStream
                );

            }

        }

    }


    /*
     * Tela.
     */
    if (localScreenStream) {

        for (
            const track
            of localScreenStream.getTracks()
        ) {

            const exists =
                pc.getSenders()
                    .some(
                        sender =>
                            sender.track &&
                            sender.track.id ===
                            track.id
                    );

            if (!exists) {

                pc.addTrack(
                    track,
                    localScreenStream
                );

            }

        }

    }
}


/* =========================================================
   GARANTIR PEER
========================================================= */

async function ensurePeerConnection(
    peerId,
    initiator
) {

    if (
        !peerId ||
        peerId === myPeerId
    ) {
        return;
    }


    const pc =
        createPeerConnection(
            peerId
        );


    if (!initiator) {
        return pc;
    }


    /*
     * Pequeno atraso para evitar
     * colisões quando várias pessoas entram.
     */
    await new Promise(
        resolve =>
            setTimeout(
                resolve,
                50
            )
    );


    try {

        if (
            pc.signalingState !==
            "stable"
        ) {

            return pc;
        }


        if (
            makingOffer.get(peerId)
        ) {

            return pc;
        }


        makingOffer.set(
            peerId,
            true
        );


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
            "Erro criando oferta:",
            error
        );

    } finally {

        makingOffer.delete(
            peerId
        );

    }


    return pc;
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


    const signal =
        msg.signal;

    if (!signal) {
        return;
    }


    const pc =
        createPeerConnection(
            peerId
        );


    try {

        if (
            signal.type ===
            "offer"
        ) {

            await pc.setRemoteDescription(
                signal.sdp
            );


            /*
             * Garante que nossos tracks
             * atuais estejam presentes.
             */
            addLocalTracksToPeer(
                pc
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

        /*
         * NÃO usamos muted=true aqui.
         *
         * O áudio da transmissão precisa ser ouvido.
         *
         * O áudio duplicado é evitado no WebRTC
         * mantendo somente uma conexão por participante.
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


        videos.appendChild(
            card
        );


        /*
         * Clicar libera áudio caso o navegador
         * tenha bloqueado o autoplay.
         */
        card.addEventListener(
            "click",
            () => {

                video.muted =
                    false;

                video.volume =
                    1;

                video.play()
                    .catch(
                        () => {}
                    );

                card.classList.remove(
                    "audio-locked"
                );

            }
        );

    } else {

        video =
            card.querySelector(
                "video"
            );

    }


    if (
        video &&
        video.srcObject !== stream
    ) {

        video.srcObject =
            stream;

    }


    if (video) {

        video.play()
            .catch(
                () => {

                    card.classList.add(
                        "audio-locked"
                    );

                }
            );

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

            try {
                video.pause();
            } catch {}

            video.srcObject =
                null;

        }

        card.remove();

    }


    remoteStreams.delete(
        peerId
    );


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
   FECHAR PEER
========================================================= */

function closePeer(
    peerId
) {

    const pc =
        peers.get(
            peerId
        );

    if (pc) {

        try {
            pc.close();
        } catch {}

    }

    peers.delete(
        peerId
    );

    makingOffer.delete(
        peerId
    );

    remoteStreams.delete(
        peerId
    );
}


/* =========================================================
   COMPARTILHAR TELA
========================================================= */

async function startScreenShare() {

    /*
     * Celular não transmite.
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
                 * O navegador pode disponibilizar
                 * áudio do sistema dependendo da opção escolhida.
                 */
                audio: true

            });


        localScreenStream =
            stream;


        /*
         * =================================================
         * MOSTRAR MINHA PRÓPRIA TELA
         * =================================================
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
         * =================================================
         * ENVIAR PARA TODOS
         * =================================================
         */

        for (
            const [
                peerId,
                pc
            ]
            of peers
        ) {

            /*
             * Adiciona apenas a nova tela.
             */
            for (
                const track
                of stream.getTracks()
            ) {

                const alreadyExists =
                    pc.getSenders()
                        .some(
                            sender =>
                                sender.track &&
                                sender.track.id ===
                                track.id
                        );

                if (!alreadyExists) {

                    pc.addTrack(
                        track,
                        stream
                    );

                }

            }


            /*
             * Renegociar.
             */
            try {

                if (
                    pc.signalingState ===
                    "stable"
                ) {

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

                }

            } catch (error) {

                console.error(
                    "Renegociação:",
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

    if (!videos) {
        return;
    }


    let card =
        document.getElementById(
            "local-screen"
        );


    if (!card) {

        card =
            document.createElement(
                "div"
            );

        card.className =
            "video-card local-screen";

        card.id =
            "local-screen";


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
            "Você • Compartilhando";


        card.appendChild(
            name
        );


        videos.prepend(
            card
        );

    }


    const video =
        card.querySelector(
            "video"
        );


    if (video) {

        video.srcObject =
            stream;

        video.play()
            .catch(
                () => {}
            );

    }


    emptyState?.classList.add(
        "hidden"
    );
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
     * Remover tela dos peers.
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

            if (
                sender.track &&
                sender.track.kind ===
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
     * Remover minha prévia.
     */
    const localCard =
        document.getElementById(
            "local-screen"
        );

    if (localCard) {

        const video =
            localCard.querySelector(
                "video"
            );

        if (video) {

            try {
                video.pause();
            } catch {}

            video.srcObject =
                null;

        }

        localCard.remove();

    }


    /*
     * Informar servidor.
     */
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


    if (
        videos &&
        videos.children.length === 0
    ) {

        emptyState?.classList.remove(
            "hidden"
        );

    }


    if (notifyServer) {

        toast(
            "Transmissão encerrada."
        );

    }
}


/* =========================================================
   MICROFONE
========================================================= */

async function toggleMicrophone() {

    /*
     * Celular não transmite áudio.
     */
    if (isMobile) {

        toast(
            "No celular o microfone está desativado."
        );

        return;
    }


    try {

        /*
         * Ainda não temos microfone.
         *
         * Agora o usuário autorizou.
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
             * Adicionar microfone aos peers.
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

                    const exists =
                        pc.getSenders()
                            .some(
                                sender =>
                                    sender.track &&
                                    sender.track.id ===
                                    track.id
                            );

                    if (!exists) {

                        pc.addTrack(
                            track,
                            localMicStream
                        );

                    }

                }


                /*
                 * Renegociação.
                 */
                try {

                    if (
                        pc.signalingState ===
                        "stable"
                    ) {

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

                    }

                } catch (error) {

                    console.error(
                        "Renegociação do microfone:",
                        error
                    );

                }

            }

        } else {

            /*
             * Liga/desliga sem criar
             * outro microfone.
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


        if (
            error.name ===
            "NotAllowedError"
        ) {

            toast(
                "Permissão do microfone foi negada."
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

    if (
        localMicStream
    ) {

        for (
            const track
            of localMicStream.getAudioTracks()
        ) {

            track.enabled =
                !muted;

        }

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

        try {
            document.execCommand(
                "copy"
            );
        } catch {}

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
     * Parar tela.
     */
    stopScreenShare(
        false
    );


    /*
     * Parar microfone.
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
     * Fechar peers.
     */
    for (
        const peerId
        of peers.keys()
    ) {

        closePeer(
            peerId
        );

    }


    peers.clear();

    remoteStreams.clear();

    participants.clear();


    /*
     * WebSocket.
     */
    if (socket) {

        try {
            socket.close();
        } catch {}

        socket =
            null;

    }


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
   NOME SALVO
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
   PÁGINA ABRINDO
========================================================= */

window.addEventListener(
    "load",
    () => {

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


        /*
         * Todos começam mutados.
         */
        micEnabled =
            false;

        updateMicButton();

    }
);


/* =========================================================
   ANTES DE SAIR
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
   INICIALIZAÇÃO
========================================================= */

updateMicButton();

console.log(
    "Hype Roleplay app.js carregado."
);

console.log(
    "Modo:",
    isMobile
        ? "CELULAR / ESPECTADOR"
        : "PC / TRANSMISSOR"
);
```
