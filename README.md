# Streaming de Video sobre UDP

Aplicacion web que permite listar y visualizar videos MP4 utilizando el
protocolo **UDP** como transporte para la entrega del video.

Trabajo de la materia *Programacion de Protocolos de Red*.

## Arquitectura

Los navegadores web no pueden abrir sockets UDP de forma directa, por lo
que se utiliza un **servidor puente** que traduce entre WebSocket (lado
del navegador) y UDP (lado del servidor de videos):

```
+------------------+    WebSocket    +------------------+    UDP    +-------------------+
|  Cliente Web     | <-------------> |  Servidor Web    | <-------> |  Servidor UDP     |
|  (HTML/CSS/JS)   |                 |  (Puente)        |           |  (entrega videos) |
+------------------+                 +------------------+           +-------------------+
```

- **Servidor UDP** (`servidor/servidor-udp.js`) -> puerto **41234**.
  Escucha peticiones UDP, lee los archivos `.mp4` y los envia fragmentados
  en paquetes UDP.
- **Servidor Web / Puente** (`servidor/servidor-web.js`) -> puerto **3000**.
  Sirve el cliente y reenvia los paquetes UDP al navegador via WebSocket.
- **Cliente Web** (`cliente/`) -> HTML + CSS + JS puro, sin frameworks.

## Protocolo de aplicacion (sobre UDP)

### Peticiones del cliente al servidor

| Mensaje (texto)   | Significado                          |
|-------------------|--------------------------------------|
| `LIST`            | Solicitar lista de videos disponibles |
| `GET:<nombre>`    | Solicitar la transmision de un video  |

### Respuestas del servidor

- Para `LIST`: paquete de texto `LIST:<json-array>` con los nombres.
- Para `GET`: multiples paquetes binarios con la siguiente cabecera:

| Byte(s) | Campo        | Descripcion                                |
|--------:|--------------|--------------------------------------------|
| 0       | Tipo         | `0x01`=INFO, `0x02`=DATA, `0x03`=END, `0x04`=ERROR |
| 1..4    | Secuencia    | Numero de paquete (uint32 big-endian)      |
| 5..8    | Total        | Total de paquetes (uint32 big-endian)      |
| 9..N    | Datos        | Carga util                                 |

- `INFO` -> metadatos del video (nombre, tamano, total de paquetes) en JSON.
- `DATA` -> un fragmento del archivo MP4 (hasta 1400 bytes por paquete).
- `END`  -> indica que termino la transmision.
- `ERROR` -> mensaje de error en texto.

## Estructura del proyecto

```
UDP/
+- package.json
+- README.md
+- servidor/
|  +- index.js              (arranca UDP + Web en un solo proceso)
|  +- servidor-udp.js       (servidor UDP del video)
|  +- servidor-web.js       (HTTP + WebSocket + puente UDP)
|  +- videos/               (coloca aqui los archivos .mp4)
+- cliente/
   +- index.html
   +- css/
   |  +- estilos.css
   +- js/
      +- app.js
```

## Como ejecutarlo

### 1) Requisitos

- [Node.js](https://nodejs.org/) 18 o superior.

### 2) Instalar dependencias

Desde la carpeta `UDP/`:

```
npm install
```

### 3) Colocar videos

Pon uno o varios archivos `.mp4` dentro de `servidor/videos/`.

### 4) Iniciar la aplicacion

```
npm start
```

Salida esperada:

```
[UDP] Servidor UDP escuchando en 127.0.0.1:41234
[WEB] Servidor HTTP escuchando en http://localhost:3000
[WEB] WebSocket disponible en ws://localhost:3000
[WEB] Puente conectado al servidor UDP 127.0.0.1:41234
```

### 5) Abrir el cliente

Visita en el navegador: **http://localhost:3000**

La interfaz muestra:

- A la izquierda, la lista de videos `.mp4` detectados en `servidor/videos/`.
- A la derecha, el reproductor y un panel con las estadisticas de la
  transmision UDP (paquetes esperados, recibidos, perdidos y tiempo total).

### Ejecucion por separado (opcional)

Si quieres ver el servidor UDP y el servidor web en terminales distintas,
puedes lanzarlos por separado:

```
npm run udp     # solo el servidor UDP
npm run web     # solo el servidor web + puente
```

## Notas sobre UDP

- UDP **no garantiza la entrega ni el orden** de los paquetes. El cliente
  los reordena por numero de secuencia.
- Si se pierden paquetes, el video puede no reproducirse correctamente.
  Esto es esperable y caracteristico de UDP; en TCP el sistema operativo
  retransmite automaticamente, en UDP no.
- En esta implementacion el servidor envia los paquetes con un pequeno
  retardo (`RETARDO_ENVIO_MS`) para evitar saturar el buffer del receptor.
  Subirlo o bajarlo permite observar el efecto en la perdida de paquetes.
