#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MiniWSServer } from './mini-ws.mjs';
import { editToTimeline } from './edit-to-timeline.mjs';
import { migratePreviewCompatibility, previewReadError, projectPreviewEdit } from './preview-edit.mjs';
// 書き込み前の lint ゲートと atomic 書き込みは shell と同じ共有カーネル（packages/edit-store）。
// lint 実行系が見つからない場合は fail-open（オーナー裁定 2026-08-02 — shell と同一挙動に統一）。
import { lintProjectCandidates, writeAtomic } from '../../edit-store/lib/write-gate.js';
import { projectSpeechDeclarations } from '../../edit-store/lib/index.js';
import { resolveFfmpeg, resolveFfprobe } from '../../media-bin/src/index.mjs';
import { prepareAlphaLayers } from '../../media-bin/src/alpha-intake.mjs';
import { ensureSpeechAtempo } from '../../media-bin/src/speech-atempo.mjs';
import {
  parseFrameRate,
  previewProxyVideoArgs,
  PROXY_RECIPE_VERSION,
} from '../../media-bin/src/proxy-recipe.mjs';
import { resolveCaptionApiPayload } from './caption-api.mjs';

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
  '.ttf': 'font/ttf',
};

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const CAPTION_FONT_PATH = fileURLToPath(new URL('../../../assets/font/noto-sans-jp/NotoSansJP-Variable.ttf', import.meta.url));
const CAPTION_FONT_ROUTE = '/assets/fonts/akari-noto-sans-jp.ttf';
// 3D オーバーレイのランタイム。どちらも素の IIFE（vendor は window.AkariThree、
// runtime は window.akari.threeRuntime を立てる）なのでバンドルは要らず、
// 字幕フォントと同じ「リポ所有の固定ルート」で配る（776KB を public/ へ複製しない）。
// projectRoot もユーザー入力も経由しないため traversal で別ファイルを選べない。
const THREE_ROUTES = {
  '/three-bundle.js': fileURLToPath(new URL('../../overlay-runtime/src/vendor/three-bundle.js', import.meta.url)),
  '/vendor-3d-text-bundle.js': fileURLToPath(new URL('../../overlay-runtime/src/vendor/vendor-3d-text-bundle.js', import.meta.url)),
  '/three-runtime.js': fileURLToPath(new URL('../../overlay-runtime/src/three-runtime.js', import.meta.url)),
  '/video-fx.js': fileURLToPath(new URL('../../overlay-runtime/src/video-fx.js', import.meta.url)),
};
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
const frameRateCache = new Map();

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

function detectFrameRate(filePath) {
  if (!hasFfprobe || frameRateCache.has(filePath)) return frameRateCache.get(filePath);
  try {
    const r = spawnSync(ffprobePath, [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=r_frame_rate',
      '-of', 'csv=p=0', filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
    const frameRate = r.status === 0 ? parseFrameRate(r.stdout.toString().trim()) : undefined;
    frameRateCache.set(filePath, frameRate);
    return frameRate;
  } catch { frameRateCache.set(filePath, undefined); return undefined; }
}

function proxyPathFor(filePath) {
  const rel = path.relative(projectRoot, filePath);
  return path.join(PROXY_DIR, rel + `.h264-${PROXY_RECIPE_VERSION}.mp4`);
}

function ensureProxy(filePath) {
  if (!hasFfmpeg) return null;
  const proxy = proxyPathFor(filePath);
  if (fs.existsSync(proxy)) return proxy;
  const dir = path.dirname(proxy);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fps = detectFrameRate(filePath);
  const r = spawnSync(ffmpegPath, [
    '-i', filePath,
    ...previewProxyVideoArgs({ fps, pixFmt: 'yuv420p', preset: 'fast', crf: 23 }),
    '-c:a', 'aac',
    '-movflags', '+faststart',
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

// mtime + サイズの検証子。中身のハッシュではないので編集は必ず検知でき、
// かつ stat 1 回で済む（効果音のような多数の小ファイルでも安い）。
function fileEtag(stat) {
  return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

// readFileSync はシングルスレッドのイベントループを丸ごと止める。効果音の多い
// プロジェクトでは音声取得が数十本走るため、その間 <video> のレンジ要求が返せず
// 再生が stall する（= 読み込み中スピナー）。ストリームで返して塞がないようにする。
// あわせて条件付き GET に対応する。cache-control: no-cache は維持（毎回検証するので
// 編集のホットリロードは従来どおり効く）が、変わっていなければ 304 で本文を送らない。
function serveFile(res, filePath, contentType, extraHeaders = {}, reqHeaders = null) {
  let stat;
  try {
    stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    respond(res, 404, { error: 'File not found' });
    return true;
  }
  const etag = fileEtag(stat);
  const headers = {
    'content-type': contentType,
    'access-control-allow-origin': '*',
    'cache-control': 'no-cache',
    etag,
    'last-modified': new Date(stat.mtimeMs).toUTCString(),
    ...extraHeaders,
  };
  if (reqHeaders && reqHeaders['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  res.writeHead(200, { ...headers, 'content-length': stat.size });
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
  return true;
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

// --- 編集履歴（edit.json を上書きする直前の状態を世代保存する） ---
// 置き場は .akari/history/。プロジェクト直下ではないので watch（edit.json / captions.json のみ）
// を誘発せず、リロードの無限ループにならない。
const HISTORY_DIR = path.join(projectRoot, '.akari', 'history');
const HISTORY_KEEP = 50;

function snapshotEdit() {
  const source = path.join(projectRoot, 'edit.json');
  try {
    if (!fs.existsSync(source)) return null; // 初回作成時は退避するものが無い
    ensureDir(HISTORY_DIR);
    // ファイル名で時系列に並ぶようにする（ISO8601 のコロンはファイル名に使えないので置換）
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(HISTORY_DIR, `edit-${stamp}.json`);
    fs.copyFileSync(source, dest);
    // 保持数を超えた古い世代を捨てる
    const files = fs.readdirSync(HISTORY_DIR)
      .filter((name) => /^edit-.*\.json$/.test(name))
      .sort();
    for (const name of files.slice(0, Math.max(0, files.length - HISTORY_KEEP))) {
      try { fs.unlinkSync(path.join(HISTORY_DIR, name)); } catch { /* 競合は無視 */ }
    }
    return path.relative(projectRoot, dest);
  } catch (e) {
    // 履歴が取れなくても編集自体は通す（安全網であって関門ではない）
    console.error('[history] 退避に失敗しました', e.message);
    return null;
  }
}

function listHistory() {
  try {
    if (!fs.existsSync(HISTORY_DIR)) return [];
    return fs.readdirSync(HISTORY_DIR)
      .filter((name) => /^edit-.*\.json$/.test(name))
      .sort()
      .reverse()
      .map((name) => {
        const full = path.join(HISTORY_DIR, name);
        const stat = fs.statSync(full);
        return { name, savedAt: new Date(stat.mtimeMs).toISOString(), bytes: stat.size };
      });
  } catch {
    return [];
  }
}

function readJson(filePath) {
  try {
    return { data: JSON.parse(fs.readFileSync(filePath, 'utf-8')) };
  } catch (e) {
    return { error: e.message };
  }
}

// preview / render が異なる edit.json を読む状態を作らない。版判定と v2 tracks-first の
// 正規化は edit-store、既存プレーヤー向け互換ビューへの射影は render-cut の純関数をそのまま使う。
// raw JSON が必要な編集 UI には /api/raw-edit.json があるため、この入口では返さない。
function readPreviewEdit(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    return {
      data: projectPreviewEdit(text, path.join(projectRoot, '.akari', 'preview-projection'), projectRoot),
    };
  } catch (error) {
    return { error };
  }
}

async function readFrameEnginePreviewEdit(filePath) {
  const read = readPreviewEdit(filePath);
  if (read.error) return read;
  const prepared = await prepareAlphaLayers(read.data, { projectRoot });
  const fps = Number(read.data?.output?.fps) > 0 ? Number(read.data.output.fps) : 30;
  const sources = new Map((read.data?.sources ?? []).map(source => [String(source?.id ?? ''), source]));
  const projectedSpeech = projectSpeechDeclarations(read.data?.cuts ?? [], { fps });
  const speechWarnings = [];
  const speech = await Promise.all(projectedSpeech.map(async declaration => {
    if (Math.abs(declaration.speed - 1) <= 1e-6) return declaration;
    const source = sources.get(declaration.src);
    const declaredPath = source?.path;
    if (typeof declaredPath !== 'string' || !declaredPath) return declaration;
    const startedAt = performance.now();
    const result = await ensureSpeechAtempo({
      sourcePath: path.isAbsolute(declaredPath) ? declaredPath : path.resolve(projectRoot, declaredPath),
      inSec: declaration.inSec,
      outSec: declaration.outSec,
      speed: declaration.speed,
      ffmpeg: tryResolve(resolveFfmpeg),
      cacheDir: path.join(projectRoot, '.akari', 'cache'),
    });
    const generatedMs = performance.now() - startedAt;
    if (!result.ok) {
      const warning = `speech atempo ${declaration.id} unavailable; using playbackRate: ${result.reason}`;
      speechWarnings.push(warning);
      console.warn(`[preview] ${warning}`);
      return declaration;
    }
    return {
      ...declaration,
      atempo: {
        path: path.relative(projectRoot, result.path).split(path.sep).join('/'),
        durationSec: result.durationSec,
        generatedMs,
      },
    };
  }));
  prepared.warnings.push(...speechWarnings);
  const intake = {};
  const skipped = [];
  prepared.layerResults.forEach((result, index) => {
    const layer = read.data.layers?.[index];
    const key = String(layer?.id ?? layer?.src ?? index);
    if (!result?.candidate) return;
    if (!result.ok) {
      skipped.push(key);
      return;
    }
    if (!result.intake?.alpha) return;
    intake[key] = { src: result.layer.src, mask: result.layer.mask };
  });
  const hasFrameEngineIntake = prepared.layerResults.some(result => result?.candidate);
  return {
    data: {
      ...read.data,
      audio: { ...(read.data.audio ?? {}), speech },
      ...(hasFrameEngineIntake ? {
        frameEngine: { intake, skipped, warnings: prepared.warnings },
      } : speechWarnings.length > 0 ? {
        frameEngine: { intake, skipped, warnings: speechWarnings },
      } : {}),
    },
  };
}

function respondPreviewReadError(res, error) {
  const failure = previewReadError(error);
  respond(res, failure.status, failure.body);
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
    const r = readPreviewEdit(path.join(projectRoot, 'edit.json'));
    if (r.error) return respondPreviewReadError(res, r.error);
    try {
      const timeline = editToTimeline(r.data, projectRoot);
      respond(res, 200, timeline);
    } catch (e) {
      respond(res, 500, { error: e.message });
    }
  },
  'GET /api/summary': async (req, res) => {
    const r = await readFrameEnginePreviewEdit(path.join(projectRoot, 'edit.json'));
    if (r.error) return respondPreviewReadError(res, r.error);
    respond(res, 200, r.data);
  },
  'PUT /api/edit.json': async (req, res) => {
    const body = await collectBody(req);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      return respond(res, 400, { error: 'Invalid JSON: ' + e.message });
    }
    let text;
    try {
      const candidate = req.headers['x-akari-preview-projection'] === '1'
        ? migratePreviewCompatibility(parsed) : parsed;
      text = JSON.stringify(candidate, null, 2);
    } catch (e) {
      return respond(res, 422, { error: e instanceof Error ? e.message : String(e) });
    }
    try {
      if (!noLint) {
        const lintResult = await lintProjectCandidates(projectRoot, { 'edit.json': text });
        if (!lintResult.pass) {
          return respond(res, 422, { error: 'Lint failed', findings: lintResult.findings });
        }
      }
      // 上書きする前の状態を必ず 1 世代残す。ドラッグ 1 回で書き換わる編集面なので、
      // 「気づかないうちにずれていて、数日後に発見する」が現実に起きる（実機 2026-08-07:
      // 誤ドラッグ 4 件が edit.json に混入、うち 1 件は移動量 0.00004px）。
      // クライアント側の undo はリロードで消えるため、保証はここに置く。
      const snapshot = snapshotEdit();
      markSelfWrite();
      await writeAtomic(path.join(projectRoot, 'edit.json'), text);
      wss.broadcast(JSON.stringify({ type: 'reload', ts: Date.now() }));
      respond(res, 200, { ok: true, snapshot });
    } catch (e) {
      respond(res, 500, { error: e.message });
    }
  },
  'GET /api/edit-history': (req, res) => respond(res, 200, { entries: listHistory() }),
  // 世代を書き戻す。書き戻し自体も 1 世代残すので、戻しすぎても前へ進み直せる。
  'POST /api/edit-history/restore': async (req, res) => {
    let name;
    try { ({ name } = JSON.parse(await collectBody(req))); }
    catch (e) { return respond(res, 400, { error: 'Invalid JSON: ' + e.message }); }
    // 履歴の実ファイル名だけを受け付ける（パスを一切組み立てさせない）
    if (typeof name !== 'string' || !/^edit-[\w-]+\.json$/.test(name)) {
      return respond(res, 400, { error: 'Invalid history name' });
    }
    const source = path.join(HISTORY_DIR, name);
    if (!fs.existsSync(source)) return respond(res, 404, { error: 'History entry not found' });
    let text;
    try { text = JSON.stringify(JSON.parse(fs.readFileSync(source, 'utf-8')), null, 2); }
    catch (e) { return respond(res, 422, { error: '履歴が壊れています: ' + e.message }); }
    try {
      const snapshot = snapshotEdit();
      markSelfWrite();
      await writeAtomic(path.join(projectRoot, 'edit.json'), text);
      wss.broadcast(JSON.stringify({ type: 'reload', ts: Date.now() }));
      respond(res, 200, { ok: true, restored: name, snapshot });
    } catch (e) {
      respond(res, 500, { error: e.message });
    }
  },
  'GET /api/captions.json': (req, res) => {
    const r = readJson(path.join(projectRoot, 'captions.json'));
    if (r.error) return respond(res, 200, []);
    if (Array.isArray(r.data) || !r.data || typeof r.data !== 'object' || r.data.display_policy === undefined) {
      return respond(res, 200, r.data);
    }
    const edit = readJson(path.join(projectRoot, 'edit.json'));
    if (edit.error) return respond(res, 422, { error: 'edit.json is required to resolve caption display policy' });
    try {
      respond(res, 200, resolveCaptionApiPayload(r.data, edit.data));
    } catch (error) {
      respond(res, 422, { error: error instanceof Error ? error.message : String(error) });
    }
  },
  'PUT /api/captions.json': async (req, res) => {
    const body = await collectBody(req);
    let text;
    try {
      text = JSON.stringify(JSON.parse(body), null, 2);
    } catch (e) {
      return respond(res, 400, { error: 'Invalid JSON: ' + e.message });
    }
    try {
      // shell の caption 系 RPC と同じく captions.json 候補も書き込み前に lint する（契約 §2.7）。
      if (!noLint) {
        const lintResult = await lintProjectCandidates(projectRoot, { 'captions.json': text });
        if (!lintResult.pass) {
          return respond(res, 422, { error: 'Lint failed', findings: lintResult.findings });
        }
      }
      markSelfWrite();
      await writeAtomic(path.join(projectRoot, 'captions.json'), text);
      wss.broadcast(JSON.stringify({ type: 'captions-reload', ts: Date.now() }));
      respond(res, 200, { ok: true });
    } catch (e) {
      respond(res, 500, { error: e.message });
    }
  },
  // 断片テキスト編集（contenteditable）の書き戻し先。overlays[].html は契約上ファイル参照
  // （edit-lint が regular file を要求）なので、マークアップは edit.json ではなく参照先の
  // 断片ファイルへ書く。edit.json へ直接マージすると lint 422 で全滅する（実測）
  'PUT /api/overlay-html': async (req, res) => {
    const body = await collectBody(req);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      return respond(res, 400, { error: 'Invalid JSON: ' + e.message });
    }
    const { id, html } = parsed ?? {};
    if (typeof id !== 'string' || !id) return respond(res, 400, { error: 'id が必要です' });
    if (typeof html !== 'string' || !html.trim()) return respond(res, 400, { error: 'html が必要です' });
    const edit = readPreviewEdit(path.join(projectRoot, 'edit.json'));
    if (edit.error) return respondPreviewReadError(res, edit.error);
    const overlay = (edit.data.overlays || []).find(o => String(o?.id) === id);
    if (!overlay) return respond(res, 404, { error: `オーバーレイが見つかりません: ${id}` });
    if (typeof overlay.html !== 'string' || !overlay.html) {
      return respond(res, 422, { error: `overlays[].html がファイル参照ではありません: ${id}` });
    }
    const target = resolveSafe(projectRoot, overlay.html);
    if (!target) return respond(res, 422, { error: 'プロジェクト外への書き込みは拒否しました' });
    try {
      if (!fs.statSync(target).isFile()) throw new Error('not a file');
    } catch {
      return respond(res, 422, { error: `断片ファイルがありません: ${overlay.html}` });
    }
    try {
      markSelfWrite();
      await writeAtomic(target, html);
      wss.broadcast(JSON.stringify({ type: 'reload', ts: Date.now() }));
      respond(res, 200, { ok: true });
    } catch (e) {
      respond(res, 500, { error: e.message });
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

function servePublicFile(res, pathname, reqHeaders = null) {
  const filePath = path.join(PUBLIC_DIR, pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    return serveFile(res, filePath, MIME[ext] ?? 'application/octet-stream', {}, reqHeaders);
  }
  return false;
}

function serveProjectFile(res, pathname, reqHeaders = null) {
  const rangeHeader = reqHeaders?.range;
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
    serveFile(res, safe, mime, extra, reqHeaders);
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

  // 3D ランタイム（リポ所有の固定ルート。断片が 3D を宣言した時だけ取りに来る）
  if (THREE_ROUTES[pathname] && req.method === 'GET') {
    return serveFile(res, THREE_ROUTES[pathname], MIME['.js'], {}, req.headers);
  }

  // Fixed route to the repository-owned caption font. It is intentionally not
  // resolved from user input or projectRoot, so traversal cannot select another file.
  if (pathname === CAPTION_FONT_ROUTE && (req.method === 'GET' || req.method === 'HEAD')) {
    if (req.method === 'HEAD') {
      try {
        const size = fs.statSync(CAPTION_FONT_PATH).size;
        res.writeHead(200, {
          'content-type': 'font/ttf',
          'content-length': size,
          'access-control-allow-origin': '*',
          'cache-control': 'public, max-age=31536000, immutable',
        });
        return res.end();
      } catch {
        return respond(res, 404, { error: 'Caption font not found' });
      }
    }
    return serveFile(res, CAPTION_FONT_PATH, 'font/ttf', {
      'cache-control': 'public, max-age=31536000, immutable',
    });
  }

  if (pathname === '/api/output-preview') {
    res.writeHead(302, { location: '/?mode=output' });
    res.end();
    return;
  }

  const prefixMatch = pathname.match(/^\/api\/asset\/(.+)/);
  if (prefixMatch) {
    const assetPath = prefixMatch[1];
    if (serveProjectFile(res, assetPath, req.headers)) return;
    return respond(res, 404, { error: 'Asset not found' });
  }

  if (servePublicFile(res, pathname, req.headers)) return;
  if (serveProjectFile(res, pathname, req.headers)) return;

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

// 1 回の編集で reload が何度も飛ぶとプレビューがその回数ぶんチラつく（実測 3 回）。
// 原因は (a) PUT 自身の通知 (b) atomic 書き込み（tmp + rename）が watch を複数回発火させること。
// 自分で書いた直後の watch イベントは PUT が既に通知済みなので捨て、残りはまとめて 1 回にする。
let selfWriteAt = 0;
function markSelfWrite() { selfWriteAt = Date.now(); }
let reloadTimer = null;
function scheduleReload() {
  if (Date.now() - selfWriteAt < 1000) return;
  if (reloadTimer) return;
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    wss.broadcast(JSON.stringify({ type: 'reload', ts: Date.now() }));
  }, 120);
}

fs.watch(projectRoot, { recursive: false }, (eventType, filename) => {
  if (filename === 'edit.json' || filename === 'captions.json') {
    scheduleReload();
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
