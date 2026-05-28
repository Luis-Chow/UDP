const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const { TIPO, TAMANO_CABECERA } = require('../compartido/protocolo');
const { prepararVideos } = require('./preparar-videos');

// Antes de arrancar, dejamos todos los videos listos para streaming
prepararVideos();

const servidor = dgram.createSocket('udp4');

function armarPaquete(tipo, secuencia, total, datos) {
    const cabecera = Buffer.alloc(TAMANO_CABECERA);
    cabecera.writeUInt8(tipo, 0);
    cabecera.writeUInt32BE(secuencia, 1);
    cabecera.writeUInt32BE(total, 5);
    return datos ? Buffer.concat([cabecera, datos]) : cabecera;
}

function listarVideos() {
    if (!fs.existsSync(config.CARPETA_VIDEOS)) return [];
    return fs.readdirSync(config.CARPETA_VIDEOS)
        .filter(nombre => nombre.toLowerCase().endsWith('.mp4'));
}

function enviarLista(direccion, puerto) {
    const lista = listarVideos();
    const mensaje = 'LIST:' + JSON.stringify(lista);
    servidor.send(mensaje, puerto, direccion);
    console.log(`[UDP] Lista enviada a ${direccion}:${puerto} (${lista.length} videos)`);
}

// Transmisiones en curso por cliente ("ip:puerto" -> token de cancelacion).
// Si un cliente pide otro video antes de que termine el actual, marcamos el
// token viejo como cancelado para que su bucle de envio se detenga.
const transmisiones = new Map();

function enviarVideo(nombre, direccion, puerto) {
    const clienteId = `${direccion}:${puerto}`;

    // Cancelar la transmision anterior de este cliente, si la hay
    const anterior = transmisiones.get(clienteId);
    if (anterior) anterior.cancelado = true;

    const ruta = path.join(config.CARPETA_VIDEOS, nombre);
    if (!fs.existsSync(ruta)) {
        const err = armarPaquete(TIPO.ERROR, 0, 0, Buffer.from('Video no encontrado'));
        servidor.send(err, puerto, direccion);
        return;
    }

    // Token de esta transmision. El bucle revisa token.cancelado en cada lote.
    const token = { cancelado: false };
    transmisiones.set(clienteId, token);

    const datos = fs.readFileSync(ruta);
    const totalPaquetes = Math.ceil(datos.length / config.TAMANO_PAYLOAD);
    console.log(`[UDP] Enviando "${nombre}" (${datos.length} bytes, ${totalPaquetes} paquetes)`);

    const info = Buffer.from(JSON.stringify({ nombre, tamano: datos.length, totalPaquetes }));
    servidor.send(armarPaquete(TIPO.INFO, 0, totalPaquetes, info), puerto, direccion);

    let secuencia = 0;
    function enviarLote() {
        if (token.cancelado) return; // el cliente pidio otro video, abortamos
        const limite = Math.min(secuencia + config.PAQUETES_POR_LOTE, totalPaquetes);
        for (; secuencia < limite; secuencia++) {
            const inicio = secuencia * config.TAMANO_PAYLOAD;
            const fin = Math.min(inicio + config.TAMANO_PAYLOAD, datos.length);
            const fragmento = datos.slice(inicio, fin);
            servidor.send(armarPaquete(TIPO.DATA, secuencia, totalPaquetes, fragmento), puerto, direccion);
        }
        if (secuencia < totalPaquetes) {
            if (config.PAUSA_LOTE_MS > 0) {
                setTimeout(enviarLote, config.PAUSA_LOTE_MS);
            } else {
                setImmediate(enviarLote);
            }
        } else {
            const fin = armarPaquete(TIPO.END, totalPaquetes, totalPaquetes);
            for (let i = 0; i < config.REENVIOS_FIN; i++) {
                setTimeout(() => { if (!token.cancelado) servidor.send(fin, puerto, direccion); }, i * 20);
            }
            transmisiones.delete(clienteId);
            console.log(`[UDP] "${nombre}" enviado`);
        }
    }
    enviarLote();
}

servidor.on('message', (mensaje, remitente) => {
    const peticion = mensaje.toString().trim();
    console.log(`[UDP] Peticion de ${remitente.address}:${remitente.port} -> ${peticion}`);

    if (peticion === 'LIST') {
        enviarLista(remitente.address, remitente.port);
    } else if (peticion.startsWith('GET:')) {
        enviarVideo(peticion.substring(4), remitente.address, remitente.port);
    }
});

servidor.on('listening', () => {
    servidor.setSendBufferSize(16 * 1024 * 1024);
    servidor.setRecvBufferSize(16 * 1024 * 1024);
    console.log(`[UDP] Servidor escuchando en ${config.UDP_HOST}:${config.UDP_PUERTO}`);
});

servidor.on('error', err => console.error('[UDP]', err.message));

servidor.bind(config.UDP_PUERTO, config.UDP_HOST);