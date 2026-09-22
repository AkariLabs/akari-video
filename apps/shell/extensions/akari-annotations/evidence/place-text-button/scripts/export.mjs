#!/usr/bin/env node
// 置いた文字の入った案件を OSR で書き出し、置いた文字と話した言葉が重なる時刻のフレームを 1 枚抜く（L1 専用・ffmpeg 使用）。
// 使い方: node export.mjs <project> <out.mp4> <frame.png> [time=4]
import { exportWithOsr } from '../../../../../../../packages/osr-export/src/index.mjs';
import { resolveElectronLauncher } from '../../../../../../../packages/osr-export/src/runner.mjs';
import { spawnSync } from 'node:child_process';
const [projectRoot, out, frame, time = '4'] = process.argv.slice(2);
const result = await exportWithOsr({ projectRoot, out, fps: 30, width: 1280, height: 720, duration: 9, quality: 'high', encoder: 'auto', soft: false, verify: 'off',
    launcherResolver: options => resolveElectronLauncher({ ...options, allowDesktop: false }) });
const grab = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', time, '-i', out, '-frames:v', '1', frame], { encoding: 'utf8' });
if (grab.status !== 0) throw new Error(grab.stderr);
console.log(JSON.stringify({ fellBackToLegacy: result.fellBackToLegacy, tier: result.launcher?.tier }));
