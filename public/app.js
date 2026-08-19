const volumeControl = document.getElementById('volumeControl');

// Supondo que você tenha um elemento de áudio remoto
const remoteAudio = document.getElementById('remoteAudioElement'); // ajuste conforme necessário

volumeControl.addEventListener('input', function() {
    remoteAudio.volume = this.value; // Ajuste o volume
});
