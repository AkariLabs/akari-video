// 最小限の WebSocket サーバ（ws パッケージ不使用）
// RFC 6455 準拠の minimal handshake + フレーム送受信。
// edit.json 変更通知の 1 方向通信のみに使うため、受信は実装しない。

import crypto from 'node:crypto';

const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class MiniWSServer {
  /** @param {import('node:http').Server} server */
  constructor(server) {
    this.clients = new Set();
    server.on('upgrade', (req, socket, head) => {
      this._handleUpgrade(req, socket, head);
    });
  }

  /** @param {string} data */
  broadcast(data) {
    const frame = encodeFrame(data);
    for (const socket of this.clients) {
      try { socket.write(frame); } catch { this._remove(socket); }
    }
  }

  _handleUpgrade(req, socket, _head) {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }

    const accept = crypto
      .createHash('sha1')
      .update(key + MAGIC)
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      '\r\n'
    );

    this.clients.add(socket);
    socket.on('close', () => this._remove(socket));
    socket.on('error', () => this._remove(socket));
  }

  _remove(socket) {
    this.clients.delete(socket);
    try { socket.destroy(); } catch {}
  }
}

// text フレームのみ生成（server → client の 1 方向）
function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf-8');
  const len = payload.length;

  if (len < 126) {
    const header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text
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
