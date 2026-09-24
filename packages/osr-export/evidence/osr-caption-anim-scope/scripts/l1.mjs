#!/usr/bin/env node
// OSR 書き出しの字幕の動き（textanim）が字幕ごとに閉じているかの L1（ラッパー作成の検証スクリプト）。
// 使い方: node l1.mjs <before|after> [--set=anim3|styled|all]
//   anim3  = 3 本の字幕（fade-up/float・pop/breath・spin-in/wobble。4 秒刻み・各 3 秒）
//   styled = 3 本の字幕（c-0001 = fade-up + 文字範囲 runs の run animation loop float / c-0002 = pop + 強調 one-char-bang /
//            c-0003 = 動き無し）。runs・1 文字ずつの描画・強調の宣言が漏れないかを見る
// 各セットを (a) まとめて 1 本のプロジェクト（sheet）と (b) 字幕 1 本ずつのプロジェクト（per-caption・カット = その字幕の区間）で
// render-cut --engine osr により書き出し、各字幕の in / loop / out の途中（+0.3 / +1.5 / +2.7 秒）のフレームを比べる。
// 量: ink（背景からの色差の総和 / 画素数）・色差で重みづけた重心 cx, cy・色差 > 60 の外接矩形 w, h（フレーム比）。
// フレームの SHA-256（rgb24）も記録する（before / after で 1 本ずつの書き出しが不変かを見る）。
// ffmpeg で fixture の映像を作りフレームを落とす（L1 専用。単体テストは使わない）。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const SET_ARG = process.argv.find(v => v.startsWith('--set='))?.slice(6) ?? 'all';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..');
const TMP = path.join(os.tmpdir(), 'osr-caption-anim-scope-l1');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, W = 1280, H = 720, STEP = 4, CUE = 3;
const PHASES = [['in', 0.3], ['loop', 1.5], ['out', CUE - 0.3]];
const round = (v, d = 4) => v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d;
const tail = s => String(s ?? '').replaceAll(REPO, '<repo>').replace(/\/(Users|private|var|tmp)\/[^\s)'"]+/g, '<machine-path>').slice(-2000);

function timed(text, start, end) {
    const chars = Array.from(text);
    return chars.map((char, index) => ({
        start: round(start + (end - start) * index / chars.length, 3),
        end: index === chars.length - 1 ? end : round(start + (end - start) * (index + 1) / chars.length, 3),
        text: char
    }));
}
const cue = (index, id, text, extra = {}) => ({
    id, start: index * STEP, end: index * STEP + CUE, text, speaker: null, sourceRef: null, edited: false,
    words: timed(text, index * STEP, index * STEP + CUE), ...extra
});
const anim = (inOut, loop) => ({ text_style: { animation: { in: { id: inOut }, ...(loop ? { loop: { id: loop } } : {}), out: { id: inOut } } } });

const SETS = {
    anim3: () => ({
        captions: [
            cue(0, 'c-0001', 'ふわっと上へ', anim('fade-up', 'float')),
            cue(1, 'c-0002', 'ポンと出る字幕', anim('pop', 'breath')),
            cue(2, 'c-0003', 'くるっと回る', anim('spin-in', 'wobble'))
        ]
    }),
    styled: () => {
        const c2 = cue(1, 'c-0002', '上から落ちる発見', anim('pop', null));
        const w = c2.words.slice(6, 8);
        return {
            emphasis_words: [{ id: 'e-0001', src: 'a', t_start: w[0].start, t_end: w[1].end, word: '発見', emotion: 'surprise', style_hint: 'one-char-bang' }],
            captions: [
                cue(0, 'c-0001', 'ここが一番の見所', { ...anim('fade-up', null), runs: [{ from: 2, to: 4, style: { color: '#b388ff' }, animation: { loop: { id: 'float' } } }] }),
                c2,
                cue(2, 'c-0003', '動かない字幕です')
            ]
        };
    }
};

const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
    if (result.status !== 0) throw new Error(`${command} failed: ${tail(result.stderr)}`);
    return result;
};

async function makeProject(dir, root, { seconds, sourceIn = 0 }) {
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    const base = path.join(TMP, 'base.mp4');
    run('/bin/cp', [base, path.join(dir, 'assets', 'base.mp4')]);
    await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(root, null, 2)}\n`);
    const edit = {
        version: 2, output: { width: W, height: H, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }],
        tracks: [
            { id: 'v-main', lane: 'visual', name: 'Base', items: [{ id: 'cut-base', at: 0, duration: seconds * FPS, source: { kind: 'media', src: 'a', in: sourceIn, out: sourceIn + seconds, speed: 1 } }] },
            { id: 'v-captions', lane: 'visual', name: '字幕', items: [{ id: 'captions', name: '字幕', at: 0, duration: seconds * FPS, source: { kind: 'captions', path: 'captions.json' }, items: [] }] }
        ]
    };
    await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    run('/usr/bin/git', ['init', '-q'], { cwd: dir });
    run('/usr/bin/git', ['-c', 'user.email=fixture@localhost', '-c', 'user.name=fixture', 'add', '-A'], { cwd: dir });
    run('/usr/bin/git', ['-c', 'user.email=fixture@localhost', '-c', 'user.name=fixture', 'commit', '-q', '-m', 'fixture'], { cwd: dir });
    return realpath(dir);
}

function exportOsr(project) {
    const outFile = path.join(project, 'exports', 'out.mp4');
    const started = Date.now();
    const akariHome = path.join(TMP, 'akari-home-osr-caption-anim-scope');
    const render = spawnSync(process.execPath, [path.join(REPO, 'packages', 'render-cut', 'bin', 'render-cut.mjs'), project, '--force', '--no-verify-blank', '--engine', 'osr', '--out', outFile],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL', env: { ...process.env, AKARI_HOME: akariHome } });
    return { outFile, seconds: Math.round((Date.now() - started) / 1000), status: render.status, stderr: tail(render.stderr || render.stdout) };
}

function frameAt(outFile, t, name) {
    const raw = path.join(TMP, `raw-${PHASE}`, `${name}.png`);
    run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', outFile, '-ss', String(t), '-frames:v', '1', raw]);
    const rgb = run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', raw, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' }).stdout;
    return { raw, rgb, sha256: createHash('sha256').update(rgb).digest('hex').slice(0, 16) };
}

function background(d) {
    const values = [[], [], []];
    for (const [x0, y0] of [[0, 0], [W - 16, 0], [0, H - 16], [W - 16, H - 16]]) for (let y = y0; y < y0 + 16; y++) for (let x = x0; x < x0 + 16; x++) {
        const i = (y * W + x) * 3; values[0].push(d[i]); values[1].push(d[i + 1]); values[2].push(d[i + 2]);
    }
    return values.map(v => v.sort((a, b) => a - b)[v.length >> 1]);
}
function measure(d) {
    const bg = background(d);
    let ink = 0, sx = 0, sy = 0;
    const xs = [], ys = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        const diff = Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2]));
        if (diff <= 12) continue;
        const w = diff / 255;
        ink += w; sx += w * (x + 0.5); sy += w * (y + 0.5);
        if (diff > 60) { xs.push(x); ys.push(y); }
    }
    if (ink === 0) return { ink: 0 };
    const q = (arr, p) => { if (!arr.length) return null; const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
    const left = q(xs, 0.005), right = q(xs, 0.995), top = q(ys, 0.005), bottom = q(ys, 0.995);
    return {
        ink: round(ink / (W * H), 6), cx: round(sx / ink / W), cy: round(sy / ink / H),
        w: left === null ? 0 : round((right - left + 1) / W), h: top === null ? 0 : round((bottom - top + 1) / H)
    };
}

await mkdir(path.join(TMP, `raw-${PHASE}`), { recursive: true });
const baseSeconds = 3 * STEP;
run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', `color=c=0x27313f:size=${W}x${H}:rate=${FPS}:duration=${baseSeconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(TMP, 'base.mp4')]);

const TOL = { centroid: 0.002, rect: 0.007 };
const setNames = SET_ARG === 'all' ? Object.keys(SETS) : [SET_ARG];
const RESULT = path.join(ROOT, `results-${PHASE}.json`);
let summary = {};
try { summary = JSON.parse(await readFile(RESULT, 'utf8')); } catch {}
summary.phase = PHASE;
summary.method = 'sheet = 3 本まとめて 1 プロジェクト / single = 字幕 1 本だけのプロジェクト（カット = その字幕の区間 → 出力 0〜3 秒）。render-cut --engine osr・1280×720・30fps。diff = sheet − single（フレーム比）';
summary.tolerance = TOL;
summary.sets ??= {};
for (const setName of setNames) {
    const root = SETS[setName]();
    const set = { exports: {}, captures: [] };
    const sheetProject = await makeProject(path.join(TMP, `${PHASE}-${setName}-sheet`), root, { seconds: baseSeconds });
    const sheet = exportOsr(sheetProject);
    set.exports.sheet = { seconds: sheet.seconds, status: sheet.status, ...(sheet.status ? { stderr: sheet.stderr } : {}) };
    console.log(JSON.stringify({ set: setName, export: 'sheet', seconds: sheet.seconds, status: sheet.status }));
    for (const [index, caption] of root.captions.entries()) {
        const emphasis = (root.emphasis_words ?? []).filter(e => e.t_start >= caption.start && e.t_end <= caption.end);
        // 1 本だけのプロジェクトでも字幕の時刻は元のまま（カットで source の区間を切り出し、出力 0〜3 秒へ）。
        const single = { ...(emphasis.length ? { emphasis_words: emphasis } : {}), captions: [caption] };
        const project = await makeProject(path.join(TMP, `${PHASE}-${setName}-${caption.id}`), single, { seconds: CUE, sourceIn: index * STEP });
        // カットの source.in が字幕の時刻に効くよう、captions の item は元の source 時刻を読む（render-cut の既定どおり）。
        const alone = exportOsr(project);
        set.exports[caption.id] = { seconds: alone.seconds, status: alone.status, ...(alone.status ? { stderr: alone.stderr } : {}) };
        console.log(JSON.stringify({ set: setName, export: caption.id, seconds: alone.seconds, status: alone.status }));
        for (const [phase, offset] of PHASES) {
            const entry = { id: caption.id, phase, animation: caption.text_style?.animation ?? null, runs: Boolean(caption.runs), emphasis: emphasis.length > 0 };
            if (sheet.status === 0) {
                const f = frameAt(sheet.outFile, round(index * STEP + offset, 3), `${setName}-sheet-${caption.id}-${phase}`);
                entry.sheet = { ...measure(f.rgb), sha256: f.sha256 };
            }
            if (alone.status === 0) {
                const f = frameAt(alone.outFile, offset, `${setName}-single-${caption.id}-${phase}`);
                entry.single = { ...measure(f.rgb), sha256: f.sha256 };
            }
            if (entry.sheet?.ink && entry.single?.ink) {
                const a = entry.sheet, b = entry.single;
                entry.diff = { dcx: round(a.cx - b.cx), dcy: round(a.cy - b.cy), dw: round(a.w - b.w), dh: round(a.h - b.h), inkRatio: round(a.ink / b.ink, 3) };
                entry.pass = Math.abs(entry.diff.dcx) <= TOL.centroid && Math.abs(entry.diff.dcy) <= TOL.centroid
                    && Math.abs(entry.diff.dw) <= TOL.rect && Math.abs(entry.diff.dh) <= TOL.rect;
            } else entry.pass = false;
            set.captures.push(entry);
        }
    }
    set.pass = set.captures.every(c => c.pass);
    set.worst = {
        maxAbsDcx: Math.max(...set.captures.map(c => Math.abs(c.diff?.dcx ?? Infinity))),
        maxAbsDcy: Math.max(...set.captures.map(c => Math.abs(c.diff?.dcy ?? Infinity))),
        maxAbsDw: Math.max(...set.captures.map(c => Math.abs(c.diff?.dw ?? Infinity))),
        maxAbsDh: Math.max(...set.captures.map(c => Math.abs(c.diff?.dh ?? Infinity))),
        inkRatioRange: [Math.min(...set.captures.map(c => c.diff?.inkRatio ?? NaN)), Math.max(...set.captures.map(c => c.diff?.inkRatio ?? NaN))]
    };
    summary.sets[setName] = set;
    await writeFile(RESULT, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify({ set: setName, pass: set.pass, worst: set.worst }));
}
