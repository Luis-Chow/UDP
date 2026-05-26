const http = require('http');
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const { WebSocketServer } = require('ws');

const config = require('./config');
const { TIPO, TAMANO_CABECERA } = require('../compartido/protocolo');

const MIME = {
    '.html': 'text/html',
    '.css':  'text/css',
    '.js':   'application/javascript'
};

const servidorHttp = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';

    let archivo;
    if (urlPath.startsWith('/compartido/')) {
        archivo = path.join(config.CARPETA_COMPARTIDO, urlPath.replace('/compartido/', ''));
    } else {
        archivo = path.join(config.CARPETA_CLIENTE, urlPath);
    }

    fs.readFile(archivo, (err, contenido) => {
        if (err) {
            res.writeHead(404);
            res.end('No encontrado');
            return;
        }
        const ext = path.extname(archivo).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(contenido);
    });
});

const wss = new WebSocketServer({ server: servidorHttp });

wss.on('connection', (ws) => {
    console.log('[WS] Cliente conectado');

    const udp = dgram.createSocket('udp4');
    udp.bind(0, () => {
        udp.setRecvBufferSize(16 * 1024 * 1024);
        udp.setSendBufferSize(16 * 1024 * 1024);
    });

    udp.on('message', (paquete) => {
        if (paquete.slice(0, 5).toString() === 'LIST:') {
            const lista = JSON.parse(paquete.slice(5).toString());
            ws.send(JSON.stringify({ tipo: 'lista', videos: lista }));
            return;
        }

        if (paquete.length < TAMANO_CABECERA) return;
        const tipo = paquete.readUInt8(0);
        const datos = paquete.slice(TAMANO_CABECERA);

        if (tipo === TIPO.INFO) {
            const info = JSON.parse(datos.toString());
            ws.send(JSON.stringify({ tipo: 'info', ...info }));
        } else if (tipo === TIPO.DATA) {
            ws.send(paquete, { binary: true });
        } else if (tipo === TIPO.END) {
            ws.send(JSON.stringify({ tipo: 'fin' }));
        } else if (tipo === TIPO.ERROR) {
            ws.send(JSON.stringify({ tipo: 'error', mensaje: datos.toString() }));
        }
    });

    ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.tipo === 'listar') {
            udp.send('LIST', config.UDP_PUERTO, config.UDP_HOST);
        } else if (msg.tipo === 'reproducir') {
            udp.send('GET:' + msg.video, config.UDP_PUERTO, config.UDP_HOST);
        }
    });

    ws.on('close', () => {
        console.log('[WS] Cliente desconectado');
        udp.close();
    });
});

servidorHttp.listen(config.HTTP_PUERTO, () => {
    console.log(`[WEB] Servidor HTTP en http://localhost:${config.HTTP_PUERTO}`);
});