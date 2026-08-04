// 宣言オーサリング（音源に「サビはどこか・キメはどこか・拍はどこか」を人が耳で付ける）の
// standalone HTTP サーバ本体。gallery-server.mjs と同じ流儀:
// 127.0.0.1 のみ・外部 npm 依存ゼロ・node:http のみ・状態はサイドカー JSON へ atomic 書き込み。
//
// gallery-server との違い:
// - 一覧の単位が「登録エントリ（ディレクトリ）」ではなく**トラック**である。
//   1 ディレクトリに音声が複数あるパック（akari-sounds-bgm 等）は 1 ファイル = 1 トラックとして
//   数え、id はファイル名の stem になる（音声が 1 個だけのディレクトリは id = ディレクトリ名）。
//   これは suggest-bgm / catalog.json が使うトラック id の粒度に合わせるため。
// - 保存先は `<library-root>/declarations.json`（suggest-bgm が自動検出する既定パス）。
//   id ごとにマージし、既存の他トラックの宣言は壊さない。
// - 音声は Range 対応で配信する（長い曲のシークに必要）。
//
// 保存前にサーバ側で妥当性を検査する（fail closed）。壊れた宣言を書くと編集側の自動提案が
// 壊れるため、UI の入力ミス・古い版のクライアントからの POST をここで止める。

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'declare-template.html');

/** 区間ラベルの語彙（UI の表示名は HTML 側に持つ。ここは値の集合が正）。 */
export const SECTION_LABELS = ['intro', 'build', 'drop', 'outro', 'bridge', 'break'];
const TIME_SIGNATURES = ['4/4', '3/4', '6/8'];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const AUDIO_CONTENT_TYPES = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
};

export function declarationsPathFor(libraryRoot) {
    return path.join(libraryRoot, 'declarations.json');
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

/**
 * ライブラリを走査してトラック一覧を作る。
 * 1 ディレクトリに音声が 1 個 → id はディレクトリ名（登録エントリ 1 件 = 1 トラック）。
 * 複数 → id は各ファイルの stem（パック形式。suggest-bgm のトラック id と一致する）。
 */
export async function listTracks(libraryRoot) {
    let dirEntries;
    try {
        dirEntries = await readdir(libraryRoot, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }

    const tracks = [];
    for (const dirEntry of dirEntries) {
        if (!dirEntry.isDirectory() || dirEntry.name.startsWith('.') || dirEntry.name.startsWith('_')) continue;
        const entryDir = path.join(libraryRoot, dirEntry.name);
        let meta = {};
        try {
            meta = JSON.parse(await readFile(path.join(entryDir, 'meta.json'), 'utf8'));
        } catch {
            // meta.json が無いディレクトリも音声があれば対象にする（自分で置いた音源も宣言できる）
        }
        const files = (await readdir(entryDir, { withFileTypes: true }))
            .filter((f) => f.isFile() && AUDIO_CONTENT_TYPES[path.extname(f.name).toLowerCase()])
            .map((f) => f.name)
            .sort();
        if (files.length === 0) continue;

        for (const file of files) {
            const stem = file.replace(/\.[^.]+$/, '');
            const id = files.length === 1 ? dirEntry.name : stem;
            if (!ID_PATTERN.test(id)) continue;
            tracks.push({
                id,
                title: files.length === 1 ? (meta.title ?? dirEntry.name) : stem,
                pack: dirEntry.name,
                media: `${dirEntry.name}/${file}`,
                when_to_use: meta.when_to_use ?? null,
            });
        }
    }
    tracks.sort((a, b) => a.id.localeCompare(b.id));
    return tracks;
}

export async function loadDeclarations(libraryRoot) {
    try {
        const parsed = JSON.parse(await readFile(declarationsPathFor(libraryRoot), 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        if (error.code === 'ENOENT') return {};
        throw error;
    }
}

async function writeDeclarations(libraryRoot, declarations) {
    const targetPath = declarationsPathFor(libraryRoot);
    await mkdir(libraryRoot, { recursive: true });
    const tempPath = path.join(libraryRoot, `.declarations.${process.pid}.${randomUUID()}.tmp`);
    try {
        await writeFile(tempPath, `${JSON.stringify(declarations, null, 1)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await rename(tempPath, targetPath);
    } finally {
        try {
            await unlink(tempPath);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 宣言 1 件の妥当性検査。戻り値は問題の配列（空 = OK）。
 * duration が分かっている場合は範囲もチェックする（クライアントが送ってくる）。
 */
export function validateDeclaration(declaration, { duration = null } = {}) {
    const problems = [];
    if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
        return ['宣言がオブジェクトではありません'];
    }
    const { bpm, beat_offset_s: beatOffset, time_signature: timeSignature, sections, hit_points: hitPoints } = declaration;

    if (bpm !== null && bpm !== undefined) {
        if (!isFiniteNumber(bpm) || bpm < 20 || bpm > 300) problems.push(`bpm が範囲外です: ${bpm}（20〜300 または null）`);
    }
    if (beatOffset !== null && beatOffset !== undefined) {
        if (!isFiniteNumber(beatOffset) || beatOffset < 0) problems.push(`beat_offset_s が不正です: ${beatOffset}`);
        else if (duration !== null && beatOffset > duration) problems.push('beat_offset_s が曲の長さを超えています');
    }
    if (timeSignature !== null && timeSignature !== undefined && !TIME_SIGNATURES.includes(timeSignature)) {
        problems.push(`time_signature が語彙外です: ${timeSignature}（${TIME_SIGNATURES.join(' / ')}）`);
    }

    if (sections !== undefined) {
        if (!Array.isArray(sections)) problems.push('sections が配列ではありません');
        else {
            sections.forEach((section, index) => {
                if (!section || typeof section !== 'object') { problems.push(`sections[${index}] がオブジェクトではありません`); return; }
                if (!SECTION_LABELS.includes(section.label)) problems.push(`sections[${index}].label が語彙外です: ${section.label}`);
                if (!isFiniteNumber(section.start_sec) || section.start_sec < 0) problems.push(`sections[${index}].start_sec が不正です`);
                if (!isFiniteNumber(section.end_sec)) problems.push(`sections[${index}].end_sec が不正です`);
                else if (section.end_sec <= section.start_sec) problems.push(`sections[${index}] の終わりが開始以下です`);
                else if (duration !== null && section.end_sec > duration + 0.5) problems.push(`sections[${index}] が曲の長さを超えています`);
            });
        }
    }

    if (hitPoints !== undefined) {
        if (!Array.isArray(hitPoints)) problems.push('hit_points が配列ではありません');
        else {
            hitPoints.forEach((value, index) => {
                if (!isFiniteNumber(value) || value < 0) problems.push(`hit_points[${index}] が不正です: ${value}`);
                else if (duration !== null && value > duration + 0.5) problems.push(`hit_points[${index}] が曲の長さを超えています`);
            });
        }
    }
    return problems;
}

/** 保存する形へ正規化する（未知フィールドは落とす。既存の出所は replaced_source に残す）。 */
export function normalizeDeclaration(declaration, previous, { now = new Date() } = {}) {
    const normalized = {
        bpm: isFiniteNumber(declaration.bpm) ? declaration.bpm : null,
        beat_offset_s: isFiniteNumber(declaration.beat_offset_s) ? declaration.beat_offset_s : 0,
        time_signature: TIME_SIGNATURES.includes(declaration.time_signature) ? declaration.time_signature : '4/4',
        sections: (declaration.sections ?? []).map(({ label, start_sec: startSec, end_sec: endSec }) => ({ label, start_sec: startSec, end_sec: endSec }))
            .sort((a, b) => a.start_sec - b.start_sec),
        hit_points: [...new Set(declaration.hit_points ?? [])].sort((a, b) => a - b),
        note: typeof declaration.note === 'string' ? declaration.note : '',
        verified_at: now.toISOString(),
        source: 'declare-audio',
    };
    if (previous && typeof previous.source === 'string' && previous.source !== 'declare-audio') {
        // 購入した宣言パック等、他所由来の値を自分の耳で上書きした記録を残す
        normalized.replaced_source = previous.source;
    } else if (previous && typeof previous.replaced_source === 'string') {
        normalized.replaced_source = previous.replaced_source;
    }
    return normalized;
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
 * @param {string} libraryRoot 宣言対象の実体ライブラリ（例: ~/.akari/assets/audio）
 */
export function createDeclareServer(libraryRoot) {
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
                    // 波形描画・拍推定・ドラッグ編集のためインラインスクリプトだけ許可し、
                    // 外部オリジンへの接続・読み込みは全面禁止（ローカル完結の authoring 面）。
                    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; media-src 'self'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'",
                    'X-Content-Type-Options': 'nosniff',
                });
                res.end(html);
                return;
            }

            if (req.method === 'GET' && url.pathname === '/api/tracks') {
                const [tracks, declarations] = await Promise.all([listTracks(libraryRoot), loadDeclarations(libraryRoot)]);
                sendJson(res, 200, {
                    tracks,
                    declarations,
                    library_root: libraryRoot,
                    declarations_path: declarationsPathFor(libraryRoot),
                    section_labels: SECTION_LABELS,
                });
                return;
            }

            if (req.method === 'POST' && url.pathname === '/api/declaration') {
                let body;
                try {
                    body = JSON.parse(await readBody(req));
                } catch {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                if (typeof body.id !== 'string' || !ID_PATTERN.test(body.id)) {
                    sendJson(res, 400, { error: 'invalid_id' });
                    return;
                }
                const duration = isFiniteNumber(body.duration_sec) ? body.duration_sec : null;
                const problems = validateDeclaration(body.declaration, { duration });
                if (problems.length > 0) {
                    sendJson(res, 400, { error: 'invalid_declaration', problems });
                    return;
                }
                const saved = await mutate(async () => {
                    const declarations = await loadDeclarations(libraryRoot);
                    declarations[body.id] = normalizeDeclaration(body.declaration, declarations[body.id]);
                    await writeDeclarations(libraryRoot, declarations);
                    return declarations[body.id];
                });
                sendJson(res, 200, { id: body.id, declaration: saved, path: declarationsPathFor(libraryRoot) });
                return;
            }

            if (req.method === 'DELETE' && url.pathname === '/api/declaration') {
                const id = url.searchParams.get('id') ?? '';
                if (!ID_PATTERN.test(id)) {
                    sendJson(res, 400, { error: 'invalid_id' });
                    return;
                }
                const removed = await mutate(async () => {
                    const declarations = await loadDeclarations(libraryRoot);
                    const existed = Object.hasOwn(declarations, id);
                    delete declarations[id];
                    await writeDeclarations(libraryRoot, declarations);
                    return existed;
                });
                sendJson(res, 200, { id, removed });
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
                const contentType = AUDIO_CONTENT_TYPES[path.extname(filePath).toLowerCase()];
                if (!contentType || !(await pathExists(filePath))) {
                    sendJson(res, 404, { error: 'not_found' });
                    return;
                }
                const fileStat = await stat(filePath);
                const rangeHeader = req.headers.range;
                const match = typeof rangeHeader === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
                if (match) {
                    const start = match[1] ? Number(match[1]) : 0;
                    const end = match[2] ? Math.min(Number(match[2]), fileStat.size - 1) : fileStat.size - 1;
                    if (start > end || start >= fileStat.size) {
                        res.writeHead(416, { 'Content-Range': `bytes */${fileStat.size}` });
                        res.end();
                        return;
                    }
                    res.writeHead(206, {
                        'Content-Type': contentType,
                        'Content-Length': end - start + 1,
                        'Content-Range': `bytes ${start}-${end}/${fileStat.size}`,
                        'Accept-Ranges': 'bytes',
                        'Cache-Control': 'no-store',
                        'X-Content-Type-Options': 'nosniff',
                    });
                    createReadStream(filePath, { start, end }).pipe(res);
                    return;
                }
                res.writeHead(200, {
                    'Content-Type': contentType,
                    'Content-Length': fileStat.size,
                    'Accept-Ranges': 'bytes',
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
