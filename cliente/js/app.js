// Cliente web. Se conecta por WebSocket al servidor puente, pide la lista
// de videos y al hacer click empieza a recibir el video paquete por paquete.
// Usa MediaSource API para reproducir el video EN VIVO mientras sigue
// descargando (como YouTube).

const { TIPO, TAMANO_CABECERA } = window.Protocolo;

// MIME types comunes para MP4. Probamos varios porque no sabemos el codec
// exacto de cada video hasta que MediaSource nos diga si lo soporta o no.
// avc1 = H.264, mp4a.40.2 = AAC LC. Los 6 caracteres despues de avc1 son
// profile + constraints + level (en hex).
const MIMES_VIDEO = [
    'video/mp4; codecs="avc1.4D0033, mp4a.40.2"',  // H.264 Main 5.1 + AAC
    'video/mp4; codecs="avc1.640033, mp4a.40.2"',  // H.264 High 5.1 + AAC
    'video/mp4; codecs="avc1.4D401E, mp4a.40.2"',  // H.264 Main 3.0 + AAC
    'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',  // H.264 Baseline 3.0 + AAC
    'video/mp4; codecs="avc1.640028, mp4a.40.2"'   // H.264 High 4.0 + AAC
];

// Elementos del DOM
const lista = document.getElementById('lista-videos');
const reproductor = document.getElementById('reproductor');
const tituloVideo = document.getElementById('titulo-video');
const cargando = document.getElementById('cargando');
const textoCargando = document.getElementById('texto-cargando');
const rellenoProgreso = document.getElementById('relleno-progreso');
const porcentaje = document.getElementById('porcentaje');
const textoEstado = document.getElementById('texto-estado');
const indicadorEstado = document.getElementById('indicador-estado');
const registro = document.getElementById('registro');
const statNombre = document.getElementById('stat-nombre');
const statTamano = document.getElementById('stat-tamano');
const statEsperados = document.getElementById('stat-esperados');
const statRecibidos = document.getElementById('stat-recibidos');
const statPerdidos = document.getElementById('stat-perdidos');
const statTiempo = document.getElementById('stat-tiempo');

// Estado de la descarga actual
let ws = null;
let paquetes = null;       // paquetes recibidos indexados por secuencia
let totalEsperados = 0;
let recibidos = 0;
let nombreActual = null;
let tamanoActual = 0;
let tiempoInicio = 0;

// Estado del streaming con MediaSource
let mediaSource = null;
let sourceBuffer = null;
let proximaSecuencia = 0;  // siguiente paquete que debo empujar al video (en orden)
let colaAppend = [];       // pedazos pendientes de empujar al SourceBuffer
let appending = false;     // true si el SourceBuffer esta procesando un append
let finRecibido = false;
let modoStreaming = true;  // si MediaSource falla, caemos a modo "blob al final"

function log(msg) {
    registro.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
    registro.scrollTop = registro.scrollHeight;
}

function formatearTamano(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function actualizarEstado(clase, texto) {
    indicadorEstado.className = 'indicador ' + clase;
    textoEstado.textContent = texto;
}

// ===== Conexion WebSocket =====
function conectar() {
    ws = new WebSocket('ws://' + window.location.host);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
        actualizarEstado('conectado', 'Conectado al puente UDP');
        log('Conectado. Pidiendo lista de videos...');
        ws.send(JSON.stringify({ tipo: 'listar' }));
    };

    ws.onclose = () => {
        actualizarEstado('desconectado', 'Desconectado');
        setTimeout(conectar, 3000);
    };

    ws.onmessage = (evento) => {
        if (evento.data instanceof ArrayBuffer) {
            manejarPaquete(evento.data);
            return;
        }
        const msg = JSON.parse(evento.data);
        if (msg.tipo === 'lista')      mostrarLista(msg.videos);
        else if (msg.tipo === 'info')  iniciarDescarga(msg);
        else if (msg.tipo === 'fin')   manejarFin();
        else if (msg.tipo === 'error') { log('ERROR: ' + msg.mensaje); cargando.classList.add('oculto'); }
    };
}

// ===== Lista de videos =====
function mostrarLista(videos) {
    lista.innerHTML = '';
    if (videos.length === 0) {
        lista.innerHTML = '<li class="vacio">No hay videos en la carpeta</li>';
        return;
    }
    videos.forEach(nombre => {
        const li = document.createElement('li');
        li.textContent = nombre;
        li.onclick = () => {
            document.querySelectorAll('.lista-videos li').forEach(x => x.classList.remove('activo'));
            li.classList.add('activo');
            pedirVideo(nombre);
        };
        lista.appendChild(li);
    });
    log(`Lista recibida: ${videos.length} videos`);
}

// ===== Pedir un video =====
function pedirVideo(nombre) {
    // Reinicio TODO el estado
    paquetes = null;
    totalEsperados = 0;
    recibidos = 0;
    nombreActual = nombre;
    tiempoInicio = Date.now();
    proximaSecuencia = 0;
    colaAppend = [];
    appending = false;
    finRecibido = false;
    modoStreaming = true;

    // Si habia un MediaSource anterior, lo descarto
    if (mediaSource) {
        try { if (mediaSource.readyState === 'open') mediaSource.endOfStream(); } catch (e) {}
        mediaSource = null;
        sourceBuffer = null;
    }

    // UI
    reproductor.removeAttribute('src');
    reproductor.load();
    cargando.classList.remove('oculto');
    textoCargando.textContent = 'Solicitando video por UDP...';
    rellenoProgreso.style.width = '0%';
    porcentaje.textContent = '0%';
    tituloVideo.textContent = nombre;
    statNombre.textContent = nombre;
    statTamano.textContent = '-';
    statEsperados.textContent = '-';
    statRecibidos.textContent = '0';
    statPerdidos.textContent = '-';
    statTiempo.textContent = '-';
    actualizarEstado('transmitiendo', 'Recibiendo paquetes UDP...');

    log(`Pidiendo: ${nombre}`);
    ws.send(JSON.stringify({ tipo: 'reproducir', video: nombre }));
}

// ===== Inicio de descarga: prepara MediaSource =====
function iniciarDescarga(info) {
    totalEsperados = info.totalPaquetes;
    tamanoActual = info.tamano;
    paquetes = new Array(info.totalPaquetes);
    recibidos = 0;

    statTamano.textContent = formatearTamano(info.tamano);
    statEsperados.textContent = info.totalPaquetes;
    log(`Empieza la descarga: ${info.totalPaquetes} paquetes`);

    // Busco el primer MIME que el navegador soporte en MediaSource
    let mimeElegido = null;
    if (window.MediaSource) {
        for (const m of MIMES_VIDEO) {
            if (MediaSource.isTypeSupported(m)) { mimeElegido = m; break; }
        }
    }
    if (!mimeElegido) {
        log('Tu navegador no soporta streaming progresivo para este formato. Esperando a tener todo el video.');
        modoStreaming = false;
        return;
    }

    // Creo el MediaSource. Uso variables LOCALES (ms, sb) para que los
    // listeners no se confundan si el usuario clickea otro video en medio.
    const ms = new MediaSource();
    mediaSource = ms;
    reproductor.src = URL.createObjectURL(ms);

    ms.addEventListener('sourceopen', () => {
        // Si el usuario ya clickeo otro video, este MediaSource ya no es el activo.
        if (mediaSource !== ms) return;
        try {
            const sb = ms.addSourceBuffer(mimeElegido);
            sourceBuffer = sb;
            sb.addEventListener('updateend', () => {
                if (sourceBuffer !== sb) return; // el video cambio mientras tanto
                appending = false;
                procesarColaAppend();
            });
            log('Streaming en vivo activado (' + mimeElegido + ')');
            cargando.classList.add('oculto');
            empujarSecuenciasConsecutivas();
        } catch (e) {
            log('No se pudo activar streaming: ' + e.message);
            modoStreaming = false;
        }
    }, { once: true });
}

// ===== Llega un paquete UDP =====
function manejarPaquete(buffer) {
    if (!paquetes || buffer.byteLength < TAMANO_CABECERA) return;

    const vista = new DataView(buffer);
    const tipo = vista.getUint8(0);
    if (tipo !== TIPO.DATA) return;

    const secuencia = vista.getUint32(1, false); // big-endian
    const datos = new Uint8Array(buffer, TAMANO_CABECERA);

    // Solo cuento el paquete si no lo tenia antes (por si llega duplicado)
    if (!paquetes[secuencia]) {
        paquetes[secuencia] = datos;
        recibidos++;
    }

    // Si estamos en modo streaming, intentamos empujar al video los
    // paquetes que ya tenemos en orden consecutivo
    if (modoStreaming && sourceBuffer) {
        empujarSecuenciasConsecutivas();
    }

    // Actualizo la barra cada 32 paquetes para no saturar el navegador
    if (recibidos % 32 === 0 || recibidos === totalEsperados) {
        const p = Math.floor((recibidos / totalEsperados) * 100);
        rellenoProgreso.style.width = p + '%';
        porcentaje.textContent = p + '%';
        statRecibidos.textContent = recibidos;
        textoCargando.textContent = `Recibiendo paquetes UDP (${recibidos} / ${totalEsperados})...`;
    }
}

// ===== Empujar al video los paquetes que ya tengo en orden =====
// MediaSource necesita los bytes del MP4 en orden consecutivo. Si tengo
// los paquetes 0, 1, 2 pero falta el 3, no puedo empujar el 4 y el 5 todavia.
function empujarSecuenciasConsecutivas() {
    while (paquetes && paquetes[proximaSecuencia]) {
        colaAppend.push(paquetes[proximaSecuencia]);
        proximaSecuencia++;
    }
    procesarColaAppend();
}

// El SourceBuffer solo acepta UN append a la vez (hay que esperar updateend),
// asi que vamos sacando de la cola.
function procesarColaAppend() {
    if (appending || !sourceBuffer || sourceBuffer.updating) return;
    if (colaAppend.length === 0) {
        // Si ya no hay nada en la cola y ya recibi el END, cierro el stream
        if (finRecibido && mediaSource && mediaSource.readyState === 'open') {
            try { mediaSource.endOfStream(); } catch (e) {}
        }
        return;
    }

    // Para no llamar appendBuffer 92000 veces, junto varios paquetes seguidos
    // en un solo buffer mas grande antes de empujarlos.
    let tamano = 0;
    const lote = [];
    while (colaAppend.length > 0 && tamano < 64 * 1024) {
        const p = colaAppend.shift();
        lote.push(p);
        tamano += p.length;
    }
    const concatenado = new Uint8Array(tamano);
    let pos = 0;
    for (const p of lote) { concatenado.set(p, pos); pos += p.length; }

    try {
        appending = true;
        sourceBuffer.appendBuffer(concatenado);
    } catch (e) {
        log('Error al empujar al video: ' + e.message);
        appending = false;
        modoStreaming = false;  // fallback al modo blob completo
    }
}

// ===== Llega el END =====
function manejarFin() {
    if (!paquetes) return;
    finRecibido = true;

    const tiempo = ((Date.now() - tiempoInicio) / 1000).toFixed(2);
    const perdidos = totalEsperados - recibidos;
    statTiempo.textContent = tiempo + ' s';
    statPerdidos.textContent = perdidos;

    log(`FIN: ${recibidos}/${totalEsperados} paquetes en ${tiempo}s`);
    if (perdidos > 0) log(`Se perdieron ${perdidos} paquetes (caracteristico de UDP)`);

    if (modoStreaming && sourceBuffer) {
        // Empujo lo que falte y dejo que procesarColaAppend cierre el stream
        empujarSecuenciasConsecutivas();
        procesarColaAppend();
        actualizarEstado('conectado', 'Conectado al puente UDP');
    } else {
        // Fallback: armar el blob completo y cargarlo de una
        armarBlobYReproducir();
    }
}

function armarBlobYReproducir() {
    let tamanoTotal = 0;
    for (let i = 0; i < totalEsperados; i++) {
        if (paquetes[i]) tamanoTotal += paquetes[i].length;
    }
    const buffer = new Uint8Array(tamanoTotal);
    let pos = 0;
    for (let i = 0; i < totalEsperados; i++) {
        if (paquetes[i]) { buffer.set(paquetes[i], pos); pos += paquetes[i].length; }
    }
    const blob = new Blob([buffer], { type: 'video/mp4' });
    reproductor.src = URL.createObjectURL(blob);
    cargando.classList.add('oculto');
    actualizarEstado('conectado', 'Conectado al puente UDP');
    reproductor.play().catch(() => {});
}

document.getElementById('boton-actualizar').onclick = () => {
    log('Actualizando lista...');
    ws.send(JSON.stringify({ tipo: 'listar' }));
};

// Cuando hay suficiente video en el buffer, intento empezar a reproducir
reproductor.addEventListener('canplay', () => {
    reproductor.play().catch(() => {});
});

conectar();
