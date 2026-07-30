// 試聴ギャラリーの standalone HTTP サーバ本体。
// decision-cards（packages/decision-cards/report-helper.mjs）/ intake-form
// （packages/intake-form/intake-form-server.mjs）と同じ流儀:
// 127.0.0.1 のみ・外部 npm 依存ゼロ・node:http のみ・状態はサイドカー JSON へ
// atomic 書き込み。
//
// decision-cards との違い: 対象が単一の report.html ではなく、library-root
// 配下の複数 <id>/ ディレクトリ（各 meta.json + 音声実体）を一覧・再生する点。
// 音声そのものは /media/<id>/<filename> 経由でのみ配信し、library-root の
// 外へは一切出ない（パストラバーサル対策は decision-cards と同じ isInside 方式）。

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'gallery-template.html');

const AUDIO_CONTENT_TYPES = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
};

export function statePathFor(libraryRoot) {
    return path.join(libraryRoot, '_gallery-state.json');
}

function isInside(basePath, candidatePath) {
    const relative = path.relative(basePath, candidatePath);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function pathExists(candidate) {
    try {
        await stat(candidate);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

async function listEntries(libraryRoot) {
    let dirEntries;
    try {
        dirEntries = await readdir(libraryRoot, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }

    const entries = [];
    for (const dirEntry of dirEntries) {
        if (!dirEntry.isDirectory()) continue;
        const entryDir = path.join(libraryRoot, dirEntry.name);
        const metaPath = path.join(entryDir, 'meta.json');
        let meta;
        try {
            meta = JSON.parse(await readFile(metaPath, 'utf8'));
        } catch {
            continue;
        }
        const files = (await readdir(entryDir, { withFileTypes: true }))
            .filter((f) => f.isFile() && !['meta.json', 'preview.png'].includes(f.name))
            .map((f) => f.name)
            .filter((name) => AUDIO_CONTENT_TYPES[path.extname(name).toLowerCase()])
            .sort();
        if (files.length === 0) continue;
        entries.push({
            id: dirEntry.name,
            title: meta.title ?? dirEntry.name,
            author: meta.author ?? null,
            license: meta.license ?? null,
            mood: meta.mood ?? [],
            tempo: meta.tempo ?? null,
            files,
        });
    }
    entries.sort((a, b) => a.id.localeCompare(b.id));
    return entries;
}

async function loadState(libraryRoot) {
    const statePath = statePathFor(libraryRoot);
    try {
        return JSON.parse(await readFile(statePath, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return { decisions: {} };
        throw error;
    }
}

async function writeState(libraryRoot, state) {
    const statePath = statePathFor(libraryRoot);
    await mkdir(libraryRoot, { recursive: true });
    const tempPath = path.join(libraryRoot, `.${path.basename(statePath)}.${process.pid}.${randomUUID()}.tmp`);
    try {
        await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await rename(tempPath, statePath);
    } finally {
        try {
            await unlink(tempPath);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
}

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res, status, body) {
    const text = `${JSON.stringify(body)}\n`;
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(text),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(text);
}

/**
 * @param {string} libraryRoot 試聴対象の実体ライブラリ（例: ~/.akari/assets/audio）
 */
export function createGalleryServer(libraryRoot) {
    let mutationQueue = Promise.resolve();
    function mutate(operation) {
        const result = mutationQueue.then(operation, operation);
        mutationQueue = result.catch(() => {});
        return result;
    }

    return createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');

            if (req.method === 'GET' && url.pathname === '/') {
                const html = await readFile(TEMPLATE_PATH, 'utf8');
                res.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src data:; base-uri 'none'; form-action 'none'",
                    'X-Content-Type-Options': 'nosniff',
                });
                res.end(html);
                return;
            }

            if (req.method === 'GET' && url.pathname === '/api/entries') {
                const [entries, state] = await Promise.all([listEntries(libraryRoot), loadState(libraryRoot)]);
                sendJson(res, 200, { entries, decisions: state.decisions ?? {} });
                return;
            }

            if (req.method === 'POST' && url.pathname === '/api/decision') {
                const body = JSON.parse(await readBody(req));
                if (typeof body.id !== 'string' || !['keep', 'drop', null].includes(body.decision ?? null)) {
                    sendJson(res, 400, { error: 'invalid_body' });
                    return;
                }
                const saved = await mutate(async () => {
                    const state = await loadState(libraryRoot);
                    state.decisions = state.decisions ?? {};
                    if (body.decision === null) {
                        delete state.decisions[body.id];
                    } else {
                        state.decisions[body.id] = { decision: body.decision, decided_at: new Date().toISOString() };
                    }
                    await writeState(libraryRoot, state);
                    return state;
                });
                sendJson(res, 200, saved);
                return;
            }

            if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
                const relative = decodeURIComponent(url.pathname.slice('/media/'.length));
                if (relative.includes('..') || relative.includes('\0')) {
                    sendJson(res, 403, { error: 'forbidden' });
                    return;
                }
                const filePath = path.resolve(libraryRoot, relative);
                if (!isInside(path.resolve(libraryRoot), filePath)) {
                    sendJson(res, 403, { error: 'forbidden' });
                    return;
                }
                const ext = path.extname(filePath).toLowerCase();
                const contentType = AUDIO_CONTENT_TYPES[ext];
                if (!contentType || !(await pathExists(filePath))) {
                    sendJson(res, 404, { error: 'not_found' });
                    return;
                }
                const fileStat = await stat(filePath);
                res.writeHead(200, {
                    'Content-Type': contentType,
                    'Content-Length': fileStat.size,
                    'Cache-Control': 'no-store',
                    'X-Content-Type-Options': 'nosniff',
                });
                createReadStream(filePath).pipe(res);
                return;
            }

            sendJson(res, 404, { error: 'not_found' });
        } catch (error) {
            sendJson(res, 500, { error: 'internal_error', message: error instanceof Error ? error.message : String(error) });
        }
    });
}
