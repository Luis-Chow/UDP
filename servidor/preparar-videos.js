const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('./config');

function estaFragmentado(ruta) {
    const fd = fs.openSync(ruta, 'r');
    try {
        const tam = fs.fstatSync(fd).size;
        const cab = Buffer.alloc(16);
        let offset = 0;

        while (offset + 8 <= tam) {
            fs.readSync(fd, cab, 0, 16, offset);
            let tamCaja = cab.readUInt32BE(0);
            const tipo = cab.toString('ascii', 4, 8);

            if (tipo === 'moof') return true;   // es fragmentado
            if (tipo === 'mdat' && offset === 0) return false; // raro, sin moov antes

            if (tamCaja === 1) {
                // tamano de 64 bits guardado en los bytes 8..15
                tamCaja = Number(cab.readBigUInt64BE(8));
            } else if (tamCaja === 0) {
                break; // la caja llega hasta el final del archivo
            }
            if (tamCaja < 8) break; // caja invalida, paramos
            offset += tamCaja;
        }
        return false;
    } finally {
        fs.closeSync(fd);
    }
}

function hayFfmpeg() {
    try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

function fragmentar(ruta) {
    const temporal = ruta + '.tmp.mp4';
    execFileSync('ffmpeg', [
        '-y', '-i', ruta,
        '-c', 'copy',
        '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
        temporal
    ], { stdio: 'ignore' });
    fs.renameSync(temporal, ruta);
}

function prepararVideos() {
    if (!fs.existsSync(config.CARPETA_VIDEOS)) return;

    const videos = fs.readdirSync(config.CARPETA_VIDEOS)
        .filter(n => n.toLowerCase().endsWith('.mp4'));

    const sinFragmentar = videos.filter(
        n => !estaFragmentado(path.join(config.CARPETA_VIDEOS, n))
    );

    if (sinFragmentar.length === 0) {
        console.log('[PREP] Todos los videos estan listos para streaming');
        return;
    }

    if (!hayFfmpeg()) {
        console.warn(`[PREP] ${sinFragmentar.length} video(s) sin fragmentar y ffmpeg no esta instalado.`);
        console.warn('[PREP] Se reproduciran igual, pero sin streaming en vivo (esperando a descargar todo).');
        console.warn('[PREP] Instala ffmpeg para activar el streaming progresivo.');
        return;
    }

    for (const nombre of sinFragmentar) {
        const ruta = path.join(config.CARPETA_VIDEOS, nombre);
        console.log(`[PREP] Fragmentando "${nombre}" para streaming...`);
        try {
            fragmentar(ruta);
        } catch (e) {
            console.error(`[PREP] Error fragmentando "${nombre}": ${e.message}`);
        }
    }
    console.log('[PREP] Videos listos para streaming');
}

module.exports = { prepararVideos };
