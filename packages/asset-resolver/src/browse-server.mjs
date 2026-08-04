// `akari-assets browse` の実体。ローカル HTTP サーバを立て、browse/ の 1 ビュー HTML を配信する
// （audio-library-setup の declare-server.mjs / gallery-server.mjs と同じ「node 組み込み http のみ」
// の流儀）。データ源は本パッケージの composeState() / resolve() そのもの — CLI と同じ経路。
//
// UI の意匠（バッジ・チップ・詳細パネル）は internal リポ lab/asset-oneview-proto/ の PoC を移植。

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, resolveEffectiveBase } from './catalog.mjs';
import { resolvePreviewLocation } from './fetch-file.mjs';
import { AssetResolverError, resolve as resolveAsset } from './resolve.mjs';
import { composeState } from './state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const BROWSE_DIR = path.resolve(here, '..', 'browse');

const CONTENT_TYPES = {
  '.mp3': 'audio/mpeg',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

async function serveStaticFile(res, filePath) {
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function statusForError(error) {
  if (error instanceof AssetResolverError) {
    if (error.code === 'locked') return 403;
    if (error.code === 'not_found') return 404;
  }
  return 400;
}

export async function startBrowseServer({
  env = process.env,
  fetchImpl = fetch,
  port = 8910,
  host = '127.0.0.1',
  log = console.log,
} = {}) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${host}:${port}`);
      const pathname = url.pathname;

      if (pathname === '/' || pathname === '/index.html') {
        return await serveStaticFile(res, path.join(BROWSE_DIR, 'index.html'));
      }
      if (pathname === '/app.js') {
        return await serveStaticFile(res, path.join(BROWSE_DIR, 'app.js'));
      }

      if (pathname === '/api/items' && req.method === 'GET') {
        const state = await composeState({ env, fetchImpl });
        return sendJson(res, 200, state);
      }

      // 試聴: 音源など実体ファイルへの参照。リモート（url 型 / リモート base）は 302 で
      // 実体 URL へ委ね、ローカル base は静的配信する。/thumb と同じ解決規則（fetch-file 共有）。
      if (pathname.startsWith('/media/') && req.method === 'GET') {
        const id = decodeURIComponent(pathname.slice('/media/'.length));
        const catalog = await loadCatalog({ env, fetchImpl });
        const item = catalog.items.find((entry) => entry.id === id);
        const file = item?.files?.find((f) => /\.(mp3|wav|m4a|ogg)$/i.test(f.name ?? '')) ?? item?.files?.[0];
        const ref = file?.url ?? file?.key;
        if (!ref) return res.writeHead(404).end();
        const base = resolveEffectiveBase(env, catalog);
        const resolved = resolvePreviewLocation(base, ref);
        if (!resolved) return res.writeHead(404).end();
        if (resolved.remote) {
          res.writeHead(302, { location: resolved.location });
          return res.end();
        }
        return await serveStaticFile(res, resolved.location);
      }

      if (pathname.startsWith('/thumb/') && req.method === 'GET') {
        const id = decodeURIComponent(pathname.slice('/thumb/'.length));
        const catalog = await loadCatalog({ env, fetchImpl });
        const item = catalog.items.find((entry) => entry.id === id);
        if (!item?.preview) return res.writeHead(404).end();
        const base = resolveEffectiveBase(env, catalog);
        const resolved = resolvePreviewLocation(base, item.preview);
        if (!resolved) return res.writeHead(404).end();
        if (resolved.remote) {
          res.writeHead(302, { location: resolved.location });
          return res.end();
        }
        return await serveStaticFile(res, resolved.location);
      }

      if (pathname === '/api/fetch' && req.method === 'POST') {
        const { id, project } = await readJsonBody(req);
        if (!id) return sendJson(res, 400, { ok: false, error: 'id が必要です' });
        try {
          const result = await resolveAsset(id, { env, fetchImpl, project: project || null });
          return sendJson(res, 200, { ok: true, ...result });
        } catch (error) {
          return sendJson(res, statusForError(error), {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      res.writeHead(404).end('not found');
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      log(`akari-assets browse: http://${host}:${port}`);
      resolvePromise();
    });
  });

  return server;
}
