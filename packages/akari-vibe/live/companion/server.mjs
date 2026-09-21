import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CompanionLink } from './link.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 枠の中身は voice-panel-live 票が作った実物のタブ（live/panel/index.html）を配る。
// 同票が入る前の置き石 live/companion/panel.html は、実物が無いときだけの落とし先として残す。
const PANEL_FILE = (() => {
  const real = path.join(HERE, '..', 'panel', 'index.html');
  return existsSync(real) ? real : path.join(HERE, 'panel.html');
})();
const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
};
const readJson = req => new Promise((resolve, reject) => {
    let text = '';
    req.on('data', chunk => { text += chunk; });
    req.on('end', () => { try { resolve(text ? JSON.parse(text) : {}); } catch (error) { reject(error); } });
    req.on('error', reject);
});

export function createCompanionHandler({ port, token, link = new CompanionLink(), onState = () => {},
    serve = false, dev = false, hudHandler = null, panelFile = PANEL_FILE, panel = { width: 360, height: 240 }, needsState = () => false, onPulledState = null }) {

    let panelKey = null;
    let pingTimer = null;
    const handler = async (req, res) => {
        const expectedHost = `127.0.0.1:${typeof port === 'function' ? port() : port}`;
        const expectedOrigin = `http://${expectedHost}`;
        if (req.headers.origin && req.headers.origin !== expectedOrigin) {
            res.writeHead(403); return res.end();
        }
        if (req.headers.host !== expectedHost) {
            res.writeHead(400); return res.end();
        }
        const url = new URL(req.url, expectedOrigin);
        if (req.method === 'GET' && url.pathname === '/panel') {
            if (!panelKey || url.searchParams.get('k') !== panelKey) {
                res.writeHead(403); return res.end();
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(fs.existsSync(panelFile) ? fs.readFileSync(panelFile) : '<!doctype html><title>AKARI companion</title>');
        }
        if (url.pathname.startsWith('/companion/')) {
            if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { error: 'Unauthorized' });
            if (req.method === 'GET' && url.pathname === '/companion/manifest') {
                const nonce = url.searchParams.get('nonce');
                if (!/^[a-f0-9]{32}$/i.test(nonce ?? '')) return json(res, 400, { error: 'Invalid nonce' });
                panelKey = crypto.randomBytes(16).toString('hex');
                return json(res, 200, { protocol: 0, name: 'akari-vibe voice companion',
                    proof: crypto.createHmac('sha256', token).update(nonce).digest('hex'),
                    panelPath: `/panel?k=${panelKey}`, panel });
            }
            if (req.method === 'GET' && url.pathname === '/companion/events') {
                res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
                const remove = link.addClient(res, req.headers['last-event-id']);
                req.on('close', remove);
                // 状態をまだ 1 度も受け取っていない間につながってきたら、こちらから取りに行く
                // （契約 §4 は「接続直後にシェルが送る」だが、係が先に落ちて上がり直した場合は
                //  シェル側が「変わっていない」と見て送らないことがある。2026-09-20 実機で観測）
                if (needsState()) {
                    const timer = setTimeout(() => {
                        if (!needsState()) return;
                        link.sendInstruction('getState').then(result => {
                            if (result?.ok && result.value) (onPulledState ?? onState)(result.value);
                        }).catch(() => {});
                    }, 500);
                    timer.unref?.();
                }
                pingTimer ??= setInterval(() => {
                    for (const client of link.clients) client.write('event: ping\ndata: {}\n\n');
                }, 30_000).unref();
                return;
            }
            if (req.method === 'POST' && url.pathname === '/companion/results') {
                try {
                    const result = await readJson(req);
                    return json(res, 200, { ok: link.receiveResult(result) });
                } catch { return json(res, 400, { error: 'Invalid JSON' }); }
            }
            if (req.method === 'POST' && url.pathname === '/companion/state') {
                try {
                    const state = await readJson(req);
                    if (!['light', 'docs'].includes(state?.type)) return json(res, 400, { error: 'Invalid state' });
                    await onState(state);
                    return json(res, 200, { ok: true });
                } catch { return json(res, 400, { error: 'Invalid JSON' }); }
            }
            return json(res, 404, { error: 'Not found' });
        }
        const panelRoutes = ['/events', '/listen', '/undo-entry', '/undo', '/status', '/open-privacy', '/open-settings'];
        if (serve && !panelRoutes.includes(url.pathname) && !dev) return json(res, 404, { error: 'Not found' });
        if ((serve || ['/status', '/open-privacy', '/open-settings'].includes(url.pathname))
            && (!panelKey || url.searchParams.get('k') !== panelKey)) return json(res, 403, { error: 'Forbidden' });
        if (hudHandler) return hudHandler(req, res);
        res.writeHead(404); res.end();
    };
    handler.close = () => { if (pingTimer) clearInterval(pingTimer); link.close(); };
    handler.panelKey = () => panelKey;
    return handler;
}

export async function startCompanionServer(options) {
    const link = options.link ?? new CompanionLink();
    let server;
    const handler = createCompanionHandler({ ...options, link, port: () => options.port || server.address()?.port });
    server = http.createServer(handler);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port, '127.0.0.1', resolve);
    });
    server.on('close', handler.close);
    return { server, link, handler };
}
