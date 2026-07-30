import crypto from 'node:crypto';

const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class MiniWSServer {
  constructor(server) {
    this.clients = new Set();
    this.handlers = {};
    server.on('upgrade', (req, socket, head) => {
      this._handleUpgrade(req, socket, head);
    });
  }

  broadcast(data) {
    const frame = encodeFrame(data);
    for (const socket of this.clients) {
      try { socket.write(frame); } catch { this._remove(socket); }
    }
  }

  broadcastExcept(data, exclude) {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    const frame = encodeFrame(str);
    for (const socket of this.clients) {
      if (socket !== exclude) {
        try { socket.write(frame); } catch { this._remove(socket); }
      }
    }
  }

  on(type, handler) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(handler);
  }

  _handleUpgrade(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + MAGIC).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    this.clients.add(socket);
    socket.on('close', () => this._remove(socket));
    socket.on('error', () => this._remove(socket));
    socket.on('data', (buf) => this._onData(socket, buf));
  }

  _onData(socket, buf) {
    try {
      const msg = decodeFrame(buf);
      if (!msg) return;
      const parsed = JSON.parse(msg);
      const type = parsed.type;
      if (this.handlers[type]) {
        for (const h of this.handlers[type]) h(parsed, socket);
      }
    } catch {}
  }

  _remove(socket) {
    this.clients.delete(socket);
    try { socket.destroy(); } catch {}
  }
}

function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf-8');
  const len = payload.length;
  if (len < 126) {
    const header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
    return Buffer.concat([header, payload]);
  }
  if (len < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(len), 2);
  return Buffer.concat([header, payload]);
}

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  if (opcode !== 1) return null;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) { len = buf.readUInt16BE(offset); offset += 2; }
  else if (len === 127) { len = Number(buf.readBigUInt64BE(offset)); offset += 8; }
  let mask = null;
  if (masked) { mask = buf.slice(offset, offset + 4); offset += 4; }
  let payload = buf.slice(offset, offset + len);
  if (mask) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  }
  return payload.toString('utf-8');
}
