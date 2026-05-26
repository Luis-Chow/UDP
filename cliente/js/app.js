const { TIPO, TAMANO_CABECERA } = window.Protocolo;

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

let ws = null;
let paquetes = null;
let totalEsperados = 0;
let recibidos = 0;
let nombreActual = null;
let tamanoActual = 0;
let tiempoInicio = 0;

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
        else if (msg.tipo === 'fin')   armarVideo();
        else if (msg.tipo === 'error') { log('ERROR: ' + msg.mensaje); cargando.classList.add('oculto'); }
    };
}

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

function pedirVideo(nombre) {
    paquetes = null;
    totalEsperados = 0;
    recibidos = 0;
    nombreActual = nombre;
    tiempoInicio = Date.now();

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

function iniciarDescarga(info) {
    totalEsperados = info.totalPaquetes;
    tamanoActual = info.tamano;
    paquetes = new Array(info.totalPaquetes);
    recibidos = 0;
    statTamano.textContent = formatearTamano(info.tamano);
    statEsperados.textContent = info.totalPaquetes;
    log(`Empieza la descarga: ${info.totalPaquetes} paquetes`);
}

function manejarPaquete(buffer) {
    if (!paquetes || buffer.byteLength < TAMANO_CABECERA) return;

    const vista = new DataView(buffer);
    const tipo = vista.getUint8(0);
    if (tipo !== TIPO.DATA) return;

    const secuencia = vista.getUint32(1, false); // big-endian
    const datos = new Uint8Array(buffer, TAMANO_CABECERA);

    if (!paquetes[secuencia]) {
        paquetes[secuencia] = datos;
        recibidos++;
    }

    if (recibidos % 32 === 0 || recibidos === totalEsperados) {
        const p = Math.floor((recibidos / totalEsperados) * 100);
        rellenoProgreso.style.width = p + '%';
        porcentaje.textContent = p + '%';
        statRecibidos.textContent = recibidos;
        textoCargando.textContent = `Recibiendo paquetes UDP (${recibidos} / ${totalEsperados})...`;
    }
}

function armarVideo() {
    if (!paquetes) return;

    const tiempo = ((Date.now() - tiempoInicio) / 1000).toFixed(2);
    const perdidos = totalEsperados - recibidos;
    statTiempo.textContent = tiempo + ' s';
    statPerdidos.textContent = perdidos;

    log(`FIN: ${recibidos}/${totalEsperados} paquetes en ${tiempo}s`);
    if (perdidos > 0) log(`Se perdieron ${perdidos} paquetes (caracteristico de UDP)`);

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

    paquetes = null;
}

document.getElementById('boton-actualizar').onclick = () => {
    log('Actualizando lista...');
    ws.send(JSON.stringify({ tipo: 'listar' }));
};

conectar();
