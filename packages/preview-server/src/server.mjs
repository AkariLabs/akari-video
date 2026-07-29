#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MiniWSServer } from './mini-ws.mjs';
import { editToTimeline, setPort } from './edit-to-timeline.mjs';
import { lintProject } from '../../edit-lint/src/edit-lint.mjs';

const args = process.argv.slice(2);
let port = 3000;
let projectRoot = process.cwd();
let noLint = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = Number(args[++i]);
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

const PUBLIC_DIR = new URL('../public/', import.meta.url).pathname;
const PROXY_DIR = path.join(projectRoot, '.proxy');

// --- ffmpeg/ffprobe detection ---
const hasFfprobe = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const codecCache = new Map();

function detectCodec(filePath) {
  if (!hasFfprobe || codecCache.has(filePath)) return codecCache.get(filePath);
  try {
    const r = spawnSync('ffprobe', [
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
  const r = spawnSync('ffmpeg', [
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
    respond(res, 200, data, contentType);
  } catch {
    respond(res, 404, { error: 'File not found' });
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
        const tmp = editPath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8');
        try {
          const lintResult = await lintProject(editPath);
          if (lintResult.verdict === 'fail') {
            fs.unlinkSync(tmp);
            return respond(res, 422, { error: 'Lint failed', findings: lintResult.findings });
          }
        } catch (lintErr) {
          fs.unlinkSync(tmp);
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
    if (r.error) return respond(res, 404, { error: r.error });
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
};

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

  if (pathname === '/' || pathname === '/index.html') {
    return serveFile(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
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

fs.watch(projectRoot, { recursive: false }, (eventType, filename) => {
  if (filename === 'edit.json' || filename === 'captions.json') {
    wss.broadcast(JSON.stringify({ type: 'reload', ts: Date.now() }));
  }
});
console.log(`[watch] watching ${projectRoot}`);

server.listen(port, () => {
  console.log(`\n  AKARI Video Preview Server`);
  console.log(`  http://localhost:${port}`);
  console.log(`  project: ${projectRoot}`);
  if (hasFfprobe) console.log(`  ffprobe: available`);
  if (hasFfmpeg) console.log(`  ffmpeg: available (HEVC proxy enabled)`);
  if (!hasFfprobe) console.log(`  ffprobe: not found (HEVC detection disabled)`);
});
