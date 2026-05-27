const path = require('path');

module.exports = {
    UDP_HOST: '127.0.0.1',
    UDP_PUERTO: 41234,
    HTTP_PUERTO: 3000,

    CARPETA_VIDEOS:     path.join(__dirname, 'videos'),
    CARPETA_CLIENTE:    path.join(__dirname, '..', 'cliente'),
    CARPETA_COMPARTIDO: path.join(__dirname, '..', 'compartido'),

    TAMANO_PAYLOAD: 1400,
    PAQUETES_POR_LOTE: 16,
    REENVIOS_FIN: 5,

    // Pausa entre lotes (ms). 0 = lo mas rapido (localhost descarga en ~3s).
    // Subir para simular una red mas lenta y poder ver el streaming.
    PAUSA_LOTE_MS: 2
};