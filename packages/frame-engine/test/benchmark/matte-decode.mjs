#!/usr/bin/env node
import { resolveTool } from '../helpers/resolve-tool.mjs';

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(directory, '../..');
const repository = resolve(packageDirectory, '../..');
const generated = resolve(directory, '.generated');
mkdirSync(generated, { recursive: true });

const ffmpeg = resolveTool('ffmpeg');
const color = resolve(generated, 'matte-benchmark-color.mp4');
const alpha = resolve(generated, 'matte-benchmark-alpha.webm');
const mask = resolve(generated, 'matte-benchmark-mask.mp4');
const resultsPath = resolve(generated, 'matte-benchmark-results.json');
const reportPath = resolve(packageDirectory, 'docs/matte-report.md');

execFileSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
  '-i', "nullsrc=size=320x180:rate=30,geq=lum='48+mod(2*X+3*Y+7*N,160)':cb='96+mod(N,48)':cr='160-mod(N,48)'",
  '-t', '33', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-threads', '1',
  '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-bf', '0', '-pix_fmt', 'yuv420p',
  '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
  '-movflags', '+faststart', color
], { stdio: 'inherit' });
execFileSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=33',
  '-f', 'lavfi', '-i', "nullsrc=size=320x180:rate=30:duration=33,geq=lum='if(between(X,mod(5*N,288),mod(5*N,288)+31),255,0)'",
  '-filter_complex', '[0:v][1:v]alphamerge,format=yuva420p', '-an',
  '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '0', '-crf', '30', '-g', '30',
  '-row-mt', '1', '-threads', '4', alpha
], { stdio: 'inherit' });
execFileSync(process.execPath, [
  resolve(repository, 'skills/analyze-footage/bin/person-matte/mask-from-alpha.mjs'),
  '--input', alpha, '--out', mask, '--force'
], { stdio: 'inherit' });

writeFileSync(resolve(generated, 'matte-renderer.html'), '<!doctype html><meta charset="utf-8"><body><script src="frame-engine-matte://app/renderer.js"></script></body>\n');
execFileSync(resolve(repository, 'node_modules/esbuild/bin/esbuild'), [
  resolve(directory, 'matte-renderer.ts'), '--bundle', '--format=iife', '--platform=browser',
  '--target=chrome122', `--outfile=${resolve(generated, 'matte-renderer.js')}`
], { cwd: packageDirectory, stdio: 'inherit' });

const directElectron = resolve(repository, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const electron = existsSync(directElectron) ? directElectron : resolve(repository, 'node_modules/.bin/electron');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
rmSync(resultsPath, { force: true });
const execution = spawnSync(electron, ['--no-sandbox', resolve(directory, 'matte-main.cjs')], {
  cwd: packageDirectory,
  encoding: 'utf8',
  timeout: 190_000,
  env: environment,
  maxBuffer: 32 * 1024 * 1024
});
process.stdout.write(execution.stdout ?? '');
process.stderr.write(execution.stderr ?? '');
if (!existsSync(resultsPath)) throw new Error(`matte benchmark produced no results: ${execution.error?.message ?? execution.status}`);
const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
const cell = value => value == null ? 'skipped' : Number(value).toFixed(3);
const integer = value => value == null ? 'skipped' : String(value);
const currentRow = (label, result) => result.skipped
  ? `| ${label} | skipped | — | — | — | — | — | — | — |\n`
  : `| ${label} | ${result.codecs.join(' + ')} | ${cell(result.uaProcessingDuration?.p50Ms)} / ${cell(result.uaProcessingDuration?.p95Ms)} | — | — | ${integer(result.currentTimeAssignments)} | ${integer(result.seekingEvents)} | ${integer(result.playbackQuality?.totalVideoFrames)} | ${integer(result.playbackQuality?.droppedVideoFrames)} |\n`;
const v2Row = results.v2.skipped
  ? '| v2 time-specified | skipped | — | — | — | — | — | — | — |\n'
  : `| v2 time-specified | ${results.v2.codecs.join(' + ')} | — | ${cell(results.v2.decodeStage?.p50Ms)} / ${cell(results.v2.decodeStage?.p95Ms)} | ${cell(results.v2.wallPerFrame?.p50Ms)} / ${cell(results.v2.wallPerFrame?.p95Ms)} | — | ${integer(results.v2.seekOperations)} | ${integer(results.v2.playbackQuality?.totalVideoFrames)} | ${integer(results.v2.playbackQuality?.droppedVideoFrames)} |\n`;
writeFileSync(reportPath, `# Person matte decode benchmark\n\n`
  + `Electron / 320x180 / 30fps / 30 seconds. The H.264 phase runs first; every phase has an independent timeout.\n\n`
  + `The current and v2 timing columns use different instruments and their absolute values are not directly comparable. The comparable outcomes are issued seek operations and dropped/failed frames.\n\n`
  + `| path | codecs | UA processing p50 / p95 ms¹ | v2 decode-stage p50 / p95 ms² | wall color+mask p50 / p95 ms³ | currentTime assignments⁴ | seeking / seek operations⁵ | total frames⁶ | dropped / failed⁶ |\n`
  + `|---|---|---:|---:|---:|---:|---:|---:|---:|\n`
  + currentRow('current tolerant', results.current.tolerant)
  + currentRow('current strict', results.current.strict)
  + v2Row
  + `\n1. UA processing is \`requestVideoFrameCallback.processingDuration\` for each VP9-alpha video callback.\n`
  + `2. v2 decode-stage is \`FrameMetrics.decode\` for each H.264 source decode.\n`
  + `3. Wall color+mask is the elapsed wall time for the parallel color and mask request pair.\n`
  + `4. Assignment count records writes to \`HTMLVideoElement.currentTime\`; tolerant writes only beyond one-frame drift, strict writes every tick.\n`
  + `5. Current rows count actual \`seeking\` events. v2 counts backwards time requests plus decoder-runtime-error recreations observed by its counting decorator.\n`
  + `6. Current rows come from \`getVideoPlaybackQuality()\`. v2 totals completed time-specified source requests and counts failed requests as dropped.\n\n`
  + `v2 seek instrumentation: backwards requests=${integer(results.v2.seekActivity?.backwardRequests)}, decoder-runtime recreations=${integer(results.v2.seekActivity?.decoderRuntimeErrors)}, software fallbacks=${integer(results.v2.seekActivity?.softwareFallbacks)}.\n\n`
  + `Cold and steady state are kept separate: tolerant cold UA=${cell(results.current.tolerant.coldProcessingDurationMs)} ms, steady p50/p95=${cell(results.current.tolerant.steadyProcessingDuration?.p50Ms)}/${cell(results.current.tolerant.steadyProcessingDuration?.p95Ms)} ms; strict cold UA=${cell(results.current.strict.coldProcessingDurationMs)} ms, steady p50/p95=${cell(results.current.strict.steadyProcessingDuration?.p50Ms)}/${cell(results.current.strict.steadyProcessingDuration?.p95Ms)} ms; v2 cold wall=${cell(results.v2.coldWallMs)} ms, steady wall p50/p95=${cell(results.v2.steadyWallPerFrame?.p50Ms)}/${cell(results.v2.steadyWallPerFrame?.p95Ms)} ms.\n\n`
  + `Skipped phases retain their reason in \`test/benchmark/.generated/matte-benchmark-results.json\`.\n`);
if (results.v2.skipped) throw new Error(`v2 matte benchmark skipped: ${results.v2.reason}`);
process.stdout.write(`matte benchmark: v2 wall p50=${cell(results.v2.wallPerFrame.p50Ms)} ms/frame, seek operations=${results.v2.seekOperations}\n`);
