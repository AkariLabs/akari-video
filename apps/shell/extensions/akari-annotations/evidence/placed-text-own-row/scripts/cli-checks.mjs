#!/usr/bin/env node
// 置いた文字の重なりの CLI 検査（L1 専用・ラッパー作成の検証スクリプト）。
// 使い方: node cli-checks.mjs <repo> <project> <label> [--render]
//   <project> の captions.json をそのまま使い、
//   (1) edit-lint --json（display_policy なし）
//   (2) display_policy を足した写しで edit-lint --json と render-cut（--render のときだけ最後まで書き出し、4 秒のフレームを 1 枚抜く）
// 結果は JSON で標準出力へ。書き出し・フレームは写しの <label>-policy/exports/ に置く（リポの外。render-cut は案件内の出力先しか受けない）。
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [repo, project, label = 'run'] = process.argv.slice(2);
const RENDER = process.argv.includes('--render');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const clean = text => String(text ?? '').replaceAll(repo, '<worktree>').replace(/\/(Users|private|tmp|var)\/[^\s)'"]+/g, '<machine-path>');

function lint(dir) {
    const r = spawnSync(process.execPath, [path.join(repo, 'packages/edit-lint/bin/edit-lint.mjs'), dir, '--json'], { encoding: 'utf8' });
    let report;
    try { report = JSON.parse(r.stdout); } catch { return { exit: r.status, parseError: clean(r.stdout + r.stderr).slice(0, 2000) }; }
    const findings = report.findings ?? [];
    return {
        exit: r.status, verdict: report.verdict,
        errors: findings.filter(f => f.severity === 'error').map(f => ({ check: f.check, message: clean(f.message).slice(0, 300) })),
        warnings: findings.filter(f => f.severity === 'warning').map(f => f.check),
    };
}

const POLICY = {
    mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1', unit_metric: 'ascii-half-other-one-v1',
    max_line_units: 16, minimum_fragment_duration_seconds: 0.5, locale: 'ja',
};

const out = { label, captions: null, lint: null, policy: null };
const root = JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8'));
out.captions = root.captions.map(c => ({ id: c.id, start: c.start, end: c.end, time_domain: c.time_domain ?? null, text: c.text }));
out.lint = lint(project);

const dir = path.join(path.dirname(project), `${label}-policy`);
await rm(dir, { recursive: true, force: true });
await cp(project, dir, { recursive: true });
await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify({ ...root, display_policy: POLICY }, null, 2)}\n`);
out.policy = { lint: lint(dir) };
const renderDir = path.join(dir, 'exports');
await mkdir(renderDir, { recursive: true });
const mp4 = path.join(renderDir, 'out.mp4');
const args = [path.join(repo, 'packages/render-cut/bin/render-cut.mjs'), dir, '--out', mp4, '--force', '--no-verify-blank'];
if (!RENDER) args.push('--plan-only');
const started = Date.now();
const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 540_000 });
const text = `${r.stdout}\n${r.stderr}`;
out.policy.renderCut = {
    mode: RENDER ? 'render' : 'plan-only', exit: r.status, seconds: Math.round((Date.now() - started) / 100) / 10,
    overlappingDisplayCues: /OVERLAPPING_DISPLAY_CUES|display cues overlap/.test(text),
    tail: clean(text).split('\n').filter(Boolean).slice(-8),
};
if (RENDER && r.status === 0) {
    const frame = path.join(renderDir, 'frame-4s.png');
    const grab = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '4', '-i', mp4, '-frames:v', '1', frame], { encoding: 'utf8' });
    out.policy.frame = grab.status === 0 ? frame : clean(grab.stderr);
}
console.log(JSON.stringify(out, null, 2));
