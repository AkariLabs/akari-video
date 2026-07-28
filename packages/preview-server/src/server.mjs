#!/usr/bin/env node
// AKARI Video Preview Server
// edit.json を監視し、ブラウザで WebCodecs ベースのプレビューを提供する。
//
// Usage:
//   node packages/preview-server/src/server.mjs [projectRoot] [--port 3000]
//
// 電子レンジ不要・headless Chrome 不要。Chromium 系ブラウザならどこでも動く。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { MiniWSServer } from './mini-ws.mjs';
import { editToTimeline, setPort } from './edit-to-timeline.mjs';

const args = process.argv.slice(2);
let port = 3000;
let projectRoot = process.cwd();

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = Number(args[++i]);
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = decodeURIComponent(url.pathname);

  // API: raw edit.json
  if (pathname === '/api/raw-edit.json') {
    return serveEditJson(res, projectRoot);
  }

  // API: timeline (edit.json → TimelineSpec)
  if (pathname === '/api/timeline') {
    return serveTimeline(res, projectRoot);
  }

  // Static: public/ ディレクトリ
  if (pathname === '/' || pathname === '/index.html') {
    return serveFile(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
  }

  // Static: public/ 配下
  const publicFile = path.join(PUBLIC_DIR, pathname);
  if (fs.existsSync(publicFile) && fs.statSync(publicFile).isFile()) {
    const ext = path.extname(publicFile);
    return serveFile(res, publicFile, MIME[ext] ?? 'application/octet-stream');
  }

  // Static: projectRoot 配下（メディアファイル用）
  const projectFile = path.join(projectRoot, pathname);
  if (fs.existsSync(projectFile) && fs.statSync(projectFile).isFile()) {
    const ext = path.extname(projectFile).toLowerCase();
    const mime = MIME[ext] ?? 'application/octet-stream';

    // Range request 対応（動画の seek に必要）
    const range = req.headers.range;
    if (range && (mime.startsWith('video/') || mime.startsWith('audio/'))) {
      return serveRange(res, projectFile, mime, range);
    }

    const extra = (mime.startsWith('video/') || mime.startsWith('audio/'))
      ? { 'accept-ranges': 'bytes' }
      : {};
    return serveFile(res, projectFile, mime, extra);
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
});

// --- helpers ---

function serveFile(res, filePath, contentType, extraHeaders = {}) {
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'content-type': contentType,
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*',
      ...extraHeaders,
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('File not found');
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
    res.writeHead(404);
    res.end('Not found');
  }
}

function serveEditJson(res, projectRoot) {
  const editPath = path.join(projectRoot, 'edit.json');
  try {
    const data = fs.readFileSync(editPath, 'utf-8');
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'edit.json not found' }));
  }
}

function serveTimeline(res, projectRoot) {
  const editPath = path.join(projectRoot, 'edit.json');
  try {
    const raw = fs.readFileSync(editPath, 'utf-8');
    const edit = JSON.parse(raw);
    const timeline = editToTimeline(edit, projectRoot);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify(timeline));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

// --- WebSocket: edit.json 変更通知 ---

const wss = new MiniWSServer(server);

// edit.json 監視
const editPath = path.join(projectRoot, 'edit.json');
let debounceTimer = null;

function notifyClients() {
  wss.broadcast(JSON.stringify({ type: 'reload', ts: Date.now() }));
}

if (fs.existsSync(editPath)) {
  fs.watch(editPath, () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(notifyClients, 200);
  });
  console.log(`[watch] watching ${editPath}`);
} else {
  console.warn(`[watch] edit.json not found at ${editPath}`);
}

// --- start ---

server.listen(port, () => {
  console.log(`\n  AKARI Video Preview Server`);
  console.log(`  http://localhost:${port}`);
  console.log(`  project: ${projectRoot}\n`);
});
