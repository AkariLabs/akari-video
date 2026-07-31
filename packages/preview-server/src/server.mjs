#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MiniWSServer } from './mini-ws.mjs';
import { editToTimeline, setPort } from './edit-to-timeline.mjs';
import { lintProject } from '../../edit-lint/src/edit-lint.mjs';
import { resolveFfmpeg, resolveFfprobe } from '../../media-bin/src/index.mjs';

const args = process.argv.slice(2);
let port = 3000;
let projectRoot = process.cwd();
let noLint = false;
let host = '127.0.0.1';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = Number(args[++i]);
  } else if (args[i] === '--host' && args[i + 1]) {
    host = args[++i];
  } else if (args[i] === '--no-lint') {
    noLint = true;
  } else if (!args[i].startsWith('-')) {
    projectRoot = path.resolve(args[i]);
  }
}

setPort(port);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const PROXY_DIR = path.join(projectRoot, '.proxy');

// --- ffmpeg/ffprobe detection ---
function tryResolve(resolver) {
  try {
    return resolver();
  } catch {
    return null;
  }
}
const ffprobePath = tryResolve(resolveFfprobe);
const ffmpegPath = tryResolve(resolveFfmpeg);
const hasFfprobe = ffprobePath !== null;
const hasFfmpeg = ffmpegPath !== null;
const codecCache = new Map();

function detectCodec(filePath) {
  if (!hasFfprobe || codecCache.has(filePath)) return codecCache.get(filePath);
  try {
    const r = spawnSync(ffprobePath, [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'csv=p=0', filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
    const codec = r.stdout.toString().trim();
    codecCache.set(filePath, codec);
    return codec;
  } catch { codecCache.set(filePath, null); return null; }
}

function proxyPathFor(filePath) {
  const rel = path.relative(projectRoot, filePath);
  return path.join(PROXY_DIR, rel + '.h264.mp4');
}

function ensureProxy(filePath) {
  if (!hasFfmpeg) return null;
  const proxy = proxyPathFor(filePath);
  if (fs.existsSync(proxy)) return proxy;
  const dir = path.dirname(proxy);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const r = spawnSync(ffmpegPath, [
    '-i', filePath,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac',
    '-y', proxy,
  ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 });
  if (r.status === 0) { console.log(`[proxy] generated ${proxy}`); return proxy; }
  console.error(`[proxy] ffmpeg failed for ${filePath}`);
  try { fs.unlinkSync(proxy); } catch {}
  return null;
}

function resolveSafe(base, userPath) {
  const resolved = path.resolve(base, userPath.replace(/^\/+/, ''));
  if (!resolved.startsWith(base)) return null;
  return resolved;
}

function respond(res, status, data, contentType = 'application/json; charset=utf-8') {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, { 'content-type': contentType, 'access-control-allow-origin': '*', 'cache-control': 'no-cache' });
  res.end(body);
}

function serveFile(res, filePath, contentType, extraHeaders = {}) {
  try {
    const data = fs.readFileSync(filePath);
    if (Buffer.isBuffer(data)) {
      res.writeHead(200, { 'content-type': contentType, 'access-control-allow-origin': '*', 'cache-control': 'no-cache', ...extraHeaders });
      res.end(data);
    } else {
      respond(res, 200, data, contentType);
    }
    return true;
  } catch {
    respond(res, 404, { error: 'File not found' });
    return true;
  }
}

function serveRange(res, filePath, contentType, rangeHeader) {
  try {
    const stat = fs.statSync(filePath);
    const total = stat.size;
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1024 * 1024 - 1, total - 1);
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'content-type': contentType,
      'content-range': `bytes ${start}-${end}/${total}`,
      'accept-ranges': 'bytes',
      'content-length': chunkSize,
      'access-control-allow-origin': '*',
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } catch {
    respond(res, 404, { error: 'Not found' });
  }
}

function readJson(filePath) {
  try {
    return { data: JSON.parse(fs.readFileSync(filePath, 'utf-8')) };
  } catch (e) {
    return { error: e.message };
  }
}

function writeJson(filePath, obj) {
  try {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8');
    fs.renameSync(tmp, filePath);
    return {};
  } catch (e) {
    return { error: e.message };
  }
}

function addOutputRoutes(routes) {
  const editFile = () => path.join(projectRoot, 'edit.output.json');
  const captionsFile = () => path.join(projectRoot, 'captions.output.json');

  function outReadJson(p) {
    try { return { data: JSON.parse(fs.readFileSync(p, 'utf-8')) }; }
    catch (e) { return { error: e.message }; }
  }

  function hasEdit() { return fs.existsSync(editFile()); }

  routes['GET /api/output/raw-edit.json'] = (req, res) => {
    if (!hasEdit()) return respond(res, 404, { error: 'edit.output.json not found' });
    const r = outReadJson(editFile());
    r.error ? respond(res, 404, { error: r.error }) : respond(res, 200, r.data);
  };
  routes['GET /api/output/summary'] = (req, res) => {
    if (!hasEdit()) return respond(res, 404, { error: 'edit.output.json not found' });
    const r = outReadJson(editFile());
    r.error ? respond(res, 404, { error: r.error }) : respond(res, 200, r.data);
  };
  routes['GET /api/output/timeline'] = (req, res) => {
    if (!hasEdit()) return respond(res, 404, { error: 'edit.output.json not found' });
    const r = outReadJson(editFile());
    if (r.error) return respond(res, 404, { error: r.error });
    try { respond(res, 200, editToTimeline(r.data, projectRoot)); }
    catch (e) { respond(res, 500, { error: e.message }); }
  };
  routes['GET /api/output/captions.json'] = (req, res) => {
    if (!hasEdit()) return respond(res, 404, { error: 'edit.output.json not found' });
    const cf = captionsFile();
    const r = outReadJson(fs.existsSync(cf) ? cf : null);
    if (!r || r.error) return respond(res, 200, []);
    respond(res, 200, r.data);
  };
}

function collectBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

const router = {
  'GET /api/raw-edit.json': (req, res) => {
    const r = readJson(path.join(projectRoot, 'edit.json'));
    if (r.error) return respond(res, 404, { error: r.error });
    respond(res, 200, r.data);
  },
  'GET /api/timeline': (req, res) => {
    const r = readJson(path.join(projectRoot, 'edit.json'));
    if (r.error) return respond(res, 404, { error: r.error });
    try {
      const timeline = editToTimeline(r.data, projectRoot);
      respond(res, 200, timeline);
    } catch (e) {
      respond(res, 500, { error: e.message });
    }
  },
  'GET /api/summary': (req, res) => {
    const r = readJson(path.join(projectRoot, 'edit.json'));
    if (r.error) return respond(res, 404, { error: r.error });
    respond(res, 200, r.data);
  },
  'PUT /api/edit.json': async (req, res) => {
    const body = await collectBody(req);
    try {
      const obj = JSON.parse(body);
      const editPath = path.join(projectRoot, 'edit.json');
      if (!noLint) {
        const tmp = editPath + '.put-tmp';
        fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8');
        try {
          const lintResult = await lintProject(projectRoot, { editPath: tmp });
          if (lintResult.verdict === 'fail') {
            if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
            return respond(res, 422, { error: 'Lint failed', findings: lintResult.findings });
          }
        } catch (lintErr) {
          if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
          return respond(res, 500, { error: 'Lint error: ' + lintErr.message });
        }
        fs.renameSync(tmp, editPath);
      } else {
        const r = writeJson(editPath, obj);
        if (r.error) return respond(res, 500, { error: r.error });
      }
      wss.broadcast(JSON.stringify({ type: 'reload', ts: Date.now() }));
      respond(res, 200, { ok: true });
    } catch (e) {
      respond(res, 400, { error: 'Invalid JSON: ' + e.message });
    }
  },
  'GET /api/captions.json': (req, res) => {
    const r = readJson(path.join(projectRoot, 'captions.json'));
    if (r.error) return respond(res, 200, []);
    respond(res, 200, r.data);
  },
  'PUT /api/captions.json': async (req, res) => {
    const body = await collectBody(req);
    try {
      const obj = JSON.parse(body);
      const r = writeJson(path.join(projectRoot, 'captions.json'), obj);
      if (r.error) return respond(res, 500, { error: r.error });
      wss.broadcast(JSON.stringify({ type: 'captions-reload', ts: Date.now() }));
      respond(res, 200, { ok: true });
    } catch (e) {
      respond(res, 400, { error: 'Invalid JSON: ' + e.message });
    }
  },
  'GET /api/codec-info': (req, res) => {
    respond(res, 200, {
      ffprobe: hasFfprobe,
      ffmpeg: hasFfmpeg,
      proxyDir: PROXY_DIR,
    });
  },
  // Review session recording
  'POST /api/review/start': async (req, res) => {
    try {
      const body = await collectBody(req);
      const { startedAt } = JSON.parse(body);
      ensureDir(path.join(projectRoot, 'review', 'sessions'));
      const dirs = fs.readdirSync(path.join(projectRoot, 'review', 'sessions'))
        .filter(d => /^s-\d{4}$/.test(d));
      const maxNum = dirs.reduce((m, d) => Math.max(m, parseInt(d.slice(2), 10)), 0);
      const id = `s-${String(maxNum + 1).padStart(4, '0')}`;
      const sessionDir = path.join(projectRoot, 'review', 'sessions', id);
      fs.mkdirSync(sessionDir, { recursive: true });
      const session = { version: 1, id, startedAt: startedAt || new Date().toISOString(), status: 'recorded' };
      writeJson(path.join(sessionDir, 'session.json'), session);
      respond(res, 200, { id });
    } catch (e) {
      respond(res, 500, { error: e.message });
    }
  },
};
const REVIEW_ROUTES = [
  { method: 'POST', pattern: /^\/api\/review\/(s-\d{4})\/audio$/, fn: async (req, res, m) => {
    const sessionDir = path.join(projectRoot, 'review', 'sessions', m[1]);
    if (!fs.existsSync(sessionDir)) return respond(res, 404, { error: 'Session not found' });
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);
    const wavPath = path.join(sessionDir, 'audio.wav');
    // Save as webm first, convert to wav via ffmpeg if available
    fs.writeFileSync(path.join(sessionDir, 'audio.webm'), buf);
    if (hasFfmpeg) {
      const r = spawnSync(ffmpegPath, ['-y', '-i', path.join(sessionDir, 'audio.webm'), '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', wavPath], { stdio: 'ignore', timeout: 30000 });
      if (r.status !== 0) console.warn('[review] ffmpeg audio conversion failed');
    } else {
      // Without ffmpeg, save raw blob as wav (likely not playable but preserves data)
      fs.writeFileSync(wavPath, buf);
    }
    respond(res, 200, { ok: true });
  }},
  { method: 'POST', pattern: /^\/api\/review\/(s-\d{4})\/events$/, fn: async (req, res, m) => {
    const sessionDir = path.join(projectRoot, 'review', 'sessions', m[1]);
    if (!fs.existsSync(sessionDir)) return respond(res, 404, { error: 'Session not found' });
    const events = JSON.parse(await collectBody(req));
    const lines = Array.isArray(events) ? events.map(e => JSON.stringify(e)).join('\n') + '\n' : '';
    fs.appendFileSync(path.join(sessionDir, 'events.jsonl'), lines, 'utf-8');
    respond(res, 200, { ok: true });
  }},
  { method: 'POST', pattern: /^\/api\/review\/(s-\d{4})\/snapshot$/, fn: async (req, res, m) => {
    const sessionDir = path.join(projectRoot, 'review', 'sessions', m[1]);
    if (!fs.existsSync(sessionDir)) return respond(res, 404, { error: 'Session not found' });
    const r = readJson(path.join(projectRoot, 'edit.json'));
    if (r.error) return respond(res, 500, { error: r.error });
    writeJson(path.join(sessionDir, 'edit.snapshot.json'), r.data);
    const hash = crypto.createHash('sha256').update(JSON.stringify(r.data)).digest('hex');
    respond(res, 200, { ok: true, editHash: `sha256:${hash}` });
  }},
  { method: 'POST', pattern: /^\/api\/review\/(s-\d{4})\/end$/, fn: async (req, res, m) => {
    const sessionDir = path.join(projectRoot, 'review', 'sessions', m[1]);
    const sessionPath = path.join(sessionDir, 'session.json');
    if (!fs.existsSync(sessionPath)) return respond(res, 404, { error: 'Session not found' });
    const { endedAt, editHash } = JSON.parse(await collectBody(req));
    const existing = readJson(sessionPath).data || {};
    writeJson(sessionPath, { ...existing, endedAt: endedAt || new Date().toISOString(), ...(editHash ? { editHash } : {}) });
    respond(res, 200, { ok: true });
  }},
];
addOutputRoutes(router);

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function servePublicFile(res, pathname) {
  const filePath = path.join(PUBLIC_DIR, pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    return serveFile(res, filePath, MIME[ext] ?? 'application/octet-stream');
  }
  return false;
}

function serveProjectFile(res, pathname, rangeHeader) {
  const safe = resolveSafe(projectRoot, pathname);
  if (!safe || !fs.existsSync(safe) || !fs.statSync(safe).isFile()) return false;
  const ext = path.extname(safe).toLowerCase();
  const mime = MIME[ext] ?? 'application/octet-stream';
  if (rangeHeader && mime.startsWith('video/')) {
    const codec = detectCodec(safe);
    if (codec === 'hevc') {
      const proxy = ensureProxy(safe);
      if (proxy) {
        console.log(`[proxy] serving ${path.basename(proxy)} for HEVC ${path.basename(safe)}`);
        serveRange(res, proxy, 'video/mp4', rangeHeader);
        return true;
      }
    }
    serveRange(res, safe, mime, rangeHeader);
  } else if (rangeHeader && mime.startsWith('audio/')) {
    serveRange(res, safe, mime, rangeHeader);
  } else {
    const extra = (mime.startsWith('video/') || mime.startsWith('audio/'))
      ? { 'accept-ranges': 'bytes' } : {};
    serveFile(res, safe, mime, extra);
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = decodeURIComponent(url.pathname);
  const routeKey = `${req.method} ${pathname}`;

  const handler = router[routeKey];
  if (handler) return handler(req, res);

  for (const r of REVIEW_ROUTES) {
    if (req.method !== r.method) continue;
    const m = pathname.match(r.pattern);
    if (m) return r.fn(req, res, m);
  }

  if (pathname === '/' || pathname === '/index.html') {
    return serveFile(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
  }

  if (pathname === '/api/output-preview') {
    res.writeHead(302, { location: '/?mode=output' });
    res.end();
    return;
  }

  const prefixMatch = pathname.match(/^\/api\/asset\/(.+)/);
  if (prefixMatch) {
    const assetPath = prefixMatch[1];
    if (serveProjectFile(res, assetPath, req.headers.range)) return;
    return respond(res, 404, { error: 'Asset not found' });
  }

  if (servePublicFile(res, pathname)) return;
  if (serveProjectFile(res, pathname, req.headers.range)) return;

  respond(res, 404, { error: 'Not found' });
});

const wss = new MiniWSServer(server);
const playState = { time: 0, playing: false };

// Bidirectional timeline sync
wss.on('tick', (msg, socket) => {
  const t = msg.time != null ? msg.time : playState.time;
  const p = msg.playing != null ? msg.playing : playState.playing;
  playState.time = t;
  playState.playing = p;
  wss.broadcastExcept({ type: 'tick', time: t, playing: p, ts: Date.now() }, socket);
});
wss.on('seek', (msg, socket) => {
  const t = msg.time != null ? msg.time : 0;
  playState.time = t;
  wss.broadcastExcept({ type: 'seek', time: t, ts: Date.now() }, socket);
});

fs.watch(projectRoot, { recursive: false }, (eventType, filename) => {
  if (filename === 'edit.json' || filename === 'captions.json') {
    wss.broadcast(JSON.stringify({ type: 'reload', ts: Date.now() }));
  }
});
console.log(`[watch] watching ${projectRoot}`);

server.listen(port, host, () => {
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`\n  AKARI Video Preview Server`);
  console.log(`  http://${displayHost}:${port}`);
  console.log(`  bind: ${host}:${port}`);
  console.log(`  project: ${projectRoot}`);
  if (hasFfprobe) console.log(`  ffprobe: available`);
  if (hasFfmpeg) console.log(`  ffmpeg: available (HEVC proxy enabled)`);
  if (!hasFfprobe) console.log(`  ffprobe: not found (HEVC detection disabled)`);
});
