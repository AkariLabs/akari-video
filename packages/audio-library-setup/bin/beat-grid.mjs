#!/usr/bin/env node
// 音楽グリッド CLI — 宣言済み BGM の拍・キメ・構成が **timeline のどこに来るか**を出し、
// 指定した発火時刻をグリッドへ寄せる（スナップ）。edit-plan の beat-sync が使う。
//
// ネットワークには触れない。BGM の長さは ffprobe（media-bin 経由）で測るか --track-duration で渡す。
//
// Usage:
//   node bin/beat-grid.mjs --track <id> --timeline <秒> [options]
//   node bin/beat-grid.mjs --edit <edit.json> [--timeline <秒>] [options]
// options:
//   --in <秒>              audio.bgm.in（--edit 指定時は edit.json から読む）
//   --track-duration <秒>  BGM ファイルの長さ（未指定なら ffprobe で測る）
//   --snap 12.3,45.6       その timeline 秒をグリッドへ寄せた結果を出す
//   --window <秒>          スナップ窓（既定 0.12）
//   --every <N>            カット候補の間隔（拍。既定 4 = 1 小節）
//   --declarations <path>  宣言 JSON（既定: <ライブラリ>/declarations.json / env AKARI_SOUNDS_DECLARATIONS）
//   --json                 機械可読出力

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { cutCandidates, musicGrid, snapToGrid } from '../shared/beat-grid.mjs';

function libraryRoot(env = process.env) {
    return path.join(env.AKARI_HOME || path.join(os.homedir(), '.akari'), 'assets', 'audio');
}

function parseArguments(argv, env = process.env) {
    const options = {
        track: null, edit: null, timeline: null, in: null, trackDuration: null,
        snap: [], window: 0.12, every: 4,
        declarations: env.AKARI_SOUNDS_DECLARATIONS || null, json: false,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--track') { options.track = argv[++i]; continue; }
        if (arg === '--edit') { options.edit = path.resolve(argv[++i]); continue; }
        if (arg === '--timeline') { options.timeline = Number(argv[++i]); continue; }
        if (arg === '--in') { options.in = Number(argv[++i]); continue; }
        if (arg === '--track-duration') { options.trackDuration = Number(argv[++i]); continue; }
        if (arg === '--snap') { options.snap = argv[++i].split(',').map(Number).filter((n) => Number.isFinite(n)); continue; }
        if (arg === '--window') { options.window = Number(argv[++i]); continue; }
        if (arg === '--every') { options.every = Number(argv[++i]); continue; }
        if (arg === '--declarations') { options.declarations = argv[++i]; continue; }
        if (arg === '--json') { options.json = true; continue; }
        throw new Error(`Unknown option: ${arg}`);
    }
    return options;
}

async function loadDeclarations(options) {
    const candidate = options.declarations
        ? path.resolve(options.declarations)
        : path.join(libraryRoot(), 'declarations.json');
    if (!existsSync(candidate)) {
        throw new Error(
            `宣言データが見つかりません: ${candidate}\n` +
            '自分で付けるなら declare-audio（node bin/declare-helper.mjs）、' +
            '購入済みなら akari store install sounds-declaration-pack で入ります。',
        );
    }
    return { declarations: JSON.parse(await readFile(candidate, 'utf8')), source: candidate };
}

/** edit.json から BGM の id / in / タイムライン長（cuts の合計）を読む。 */
async function readEdit(editPath) {
    const edit = JSON.parse(await readFile(editPath, 'utf8'));
    const bgm = edit.audio?.bgm ?? null;
    const cuts = Array.isArray(edit.cuts) ? edit.cuts : [];
    const timeline = cuts.reduce((sum, cut) => {
        const span = Number(cut.out) - Number(cut.in);
        return Number.isFinite(span) && span > 0 ? sum + span : sum;
    }, 0);
    return {
        bgmPath: bgm?.path ?? null,
        bgmIn: Number.isFinite(bgm?.in) ? bgm.in : 0,
        timelineFromCuts: timeline > 0 ? Math.round(timeline * 1000) / 1000 : null,
        editDir: path.dirname(editPath),
    };
}

function trackIdFromPath(bgmPath) {
    const base = path.basename(bgmPath).replace(/\.[^.]+$/, '');
    return base;
}

function probeDuration(filePath) {
    const result = spawnSync('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath,
    ], { encoding: 'utf8' });
    const seconds = Number(String(result.stdout ?? '').trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function formatHuman(grid, { trackId, snaps, cuts, declarationsSource }) {
    const lines = [];
    const m = grid.meta;
    lines.push(`音楽グリッド: ${trackId}（宣言: ${declarationsSource}）`);
    lines.push(`  ♩${m.bpm ?? '—'} / ${m.beats_per_bar}拍子 / 曲長 ${m.track_duration}s / in ${m.bgm_in}s / timeline ${m.timeline_duration}s（${m.loops} 周）`);
    lines.push(`  拍 ${grid.beats.length} 個 / 小節頭 ${grid.downbeats.length} / キメ ${grid.hits.length}${grid.seams.length ? ` / ループ継ぎ目 ${grid.seams.join(', ')}s` : ''}`);
    if (grid.hits.length) lines.push(`  キメ（timeline 秒）: ${grid.hits.slice(0, 12).join(', ')}${grid.hits.length > 12 ? ' …' : ''}`);
    for (const section of grid.sections) {
        lines.push(`  構成: ${section.label} ${section.start_sec}–${section.end_sec}s`);
    }
    if (cuts.length) {
        lines.push(`  カット候補（${cuts.length} 点）: ${cuts.slice(0, 12).join(', ')}${cuts.length > 12 ? ' …' : ''}`);
    }
    if (snaps.length) {
        lines.push('  スナップ:');
        for (const snap of snaps) {
            lines.push(snap.snapped
                ? `    ${snap.from}s → ${snap.t}s（${snap.kind} / ${snap.delta > 0 ? '+' : ''}${snap.delta}s）`
                : `    ${snap.from}s → 動かさない（窓内にグリッドなし）`);
        }
    }
    lines.push('  ※ 発火位置の採用は素材計画・実行の承認ゲートで決めてください（これは候補の提示まで）');
    return lines.join('\n');
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    let { track: trackId, in: bgmIn, timeline: timelineDuration, trackDuration } = options;
    let bgmFile = null;

    if (options.edit) {
        const edit = await readEdit(options.edit);
        if (!edit.bgmPath) throw new Error('edit.json に audio.bgm がありません');
        bgmFile = path.resolve(edit.editDir, edit.bgmPath);
        trackId = trackId ?? trackIdFromPath(edit.bgmPath);
        bgmIn = bgmIn ?? edit.bgmIn;
        timelineDuration = timelineDuration ?? edit.timelineFromCuts;
    }
    if (!trackId) throw new Error('--track か --edit を指定してください');
    if (!Number.isFinite(timelineDuration) || timelineDuration <= 0) {
        throw new Error('--timeline（タイムライン全長・秒）を指定してください（edit.json の cuts から求まらない場合）');
    }

    const { declarations, source } = await loadDeclarations(options);
    const declaration = declarations[trackId];
    if (!declaration) {
        throw new Error(`宣言がありません: ${trackId}（declare-audio で付けるか、宣言パックを導入してください）`);
    }

    if (!Number.isFinite(trackDuration)) {
        if (!bgmFile) {
            const guess = path.join(libraryRoot(), 'akari-sounds-bgm', `${trackId}.mp3`);
            bgmFile = existsSync(guess) ? guess : null;
        }
        trackDuration = bgmFile ? probeDuration(bgmFile) : null;
        if (!trackDuration) {
            throw new Error('BGM の長さが分かりません。--track-duration <秒> を渡してください（ffprobe が使えない場合）');
        }
    }

    const grid = musicGrid({ declaration, trackDuration, bgmIn: bgmIn ?? 0, timelineDuration });
    const snaps = options.snap.map((t) => snapToGrid(t, grid, { window: options.window }));
    const cuts = cutCandidates(grid, { every: options.every });

    if (options.json) {
        console.log(JSON.stringify({
            track: trackId, declarations_source: source, grid, snaps, cut_candidates: cuts,
        }, null, 2));
        return;
    }
    console.log(formatHuman(grid, { trackId, snaps, cuts, declarationsSource: source }));
}

main().catch((error) => {
    console.error(error.message ?? String(error));
    process.exitCode = 1;
});
