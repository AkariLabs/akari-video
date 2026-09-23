import http from 'node:http';

export function startFakeIrodori() {
    const requests = [];
    const wav = Buffer.alloc(44 + 48000);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
    wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(48000, 40);
    const server = http.createServer(async (req, res) => {
        if (req.method === 'GET' && req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok"}'); return;
        }
        if (req.method === 'POST' && req.url === '/v1/audio/speech') {
            try {
                const chunks = []; for await (const chunk of req) chunks.push(chunk);
                requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(wav);
            } catch { res.writeHead(400); res.end('bad request'); }
            return;
        }
        res.writeHead(404); res.end();
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve({ url: `http://127.0.0.1:${server.address().port}`, requests,
                stop: () => new Promise(done => server.close(done)) });
        });
    });
}
