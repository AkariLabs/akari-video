import http from 'node:http';

function wav() {
    const samples = 24000;
    const data = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 220 / 24000) * 9000), i * 2);
    const out = Buffer.alloc(44 + data.length);
    out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVE', 8);
    out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
    out.writeUInt32LE(24000, 24); out.writeUInt32LE(48000, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
    out.write('data', 36); out.writeUInt32LE(data.length, 40); data.copy(out, 44);
    return out;
}

export function startFakeIrodori() {
    const requests = [];
    const audio = wav();
    const server = http.createServer(async (req, res) => {
        if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok"}'); return; }
        if (req.method === 'POST' && req.url === '/v1/audio/voices') {
            const chunks = []; for await (const chunk of req) chunks.push(chunk);
            const body = Buffer.concat(chunks).toString('latin1');
            requests.push({ kind: 'copy', hasFile: body.includes('name="file"'), hasVoiceId: body.includes('akari-') });
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok"}'); return;
        }
        if (req.method === 'POST' && req.url === '/v1/audio/speech') {
            const chunks = []; for await (const chunk of req) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString());
            requests.push({ kind: 'try', model: body.model, voice: body.voice, input: body.input });
            res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(audio); return;
        }
        if (req.method === 'DELETE' && req.url?.startsWith('/v1/audio/voices/')) {
            requests.push({ kind: 'delete', voice: decodeURIComponent(req.url.slice('/v1/audio/voices/'.length)) });
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok"}'); return;
        }
        res.writeHead(404); res.end();
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            const port = server.address().port;
            resolve({ url: `http://127.0.0.1:${port}`, port, requests,
                stop: () => new Promise((done, fail) => server.close(error =>
                    error ? fail(error) : done({ closed: !server.listening }))) });
        });
    });
}
