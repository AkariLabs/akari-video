import http from 'node:http';
import { appendFile, writeFile } from 'node:fs/promises';

const portFile = process.argv[2];
const logFile = process.argv[3];
const data = Buffer.alloc(48000 * 2);
for (let i = 0; i < 48000; i++) data.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 220 / 48000) * 1000), i * 2);
const wav = Buffer.alloc(44 + data.length);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(data.length, 40); data.copy(wav, 44);
const record = async entry => appendFile(logFile, `${JSON.stringify(entry)}\n`);
const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok"}'); return; }
    if (req.method === 'POST' && req.url === '/v1/audio/voices') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString('latin1');
        await record({ kind: 'copy', hasFile: body.includes('name="file"'), hasVoiceId: body.includes('akari-') });
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok"}'); return;
    }
    if (req.method === 'POST' && req.url === '/v1/audio/speech') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        await record({ kind: 'try', voice: body.voice, model: body.model });
        res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(wav); return;
    }
    if (req.method === 'DELETE' && req.url?.startsWith('/v1/audio/voices/')) {
        await record({ kind: 'delete', voice: decodeURIComponent(req.url.slice('/v1/audio/voices/'.length)) });
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok"}'); return;
    }
    res.writeHead(404); res.end();
});
server.listen(0, '127.0.0.1', async () => { await writeFile(portFile, String(server.address().port)); });
process.on('SIGTERM', () => server.close(() => process.exit(0)));
