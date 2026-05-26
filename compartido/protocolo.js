(function () {
    const TIPO = {
        INFO:  0x01,
        DATA:  0x02,
        END:   0x03,
        ERROR: 0x04
    };
    const TAMANO_CABECERA = 9;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { TIPO, TAMANO_CABECERA };
    } else {
        window.Protocolo = { TIPO, TAMANO_CABECERA };
    }
})();
