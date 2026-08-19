const socket = new WebSocket('ws://SEU_SERVIDOR');

socket.onmessage = function(event) {
    const data = JSON.parse(event.data);
    // Atualize a interface conforme necessário
};

// Função para notificar a entrada e saída de usuários
function notify(action, nome) {
    socket.send(JSON.stringify({ action, nome }));
}
