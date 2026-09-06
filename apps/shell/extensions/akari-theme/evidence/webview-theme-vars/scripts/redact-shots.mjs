#!/usr/bin/env node
// 証跡 PNG からオーナーの個人情報を落とす。
// ホーム画面の「AKARI Store」カードに接続中アカウントのメールアドレスが出るため、
// その帯（x 200-1040 / y 800-960）を黒で潰す。計測点は Codex パネル内 x >= 1054、
// プレビューは固定した 0,0-1200x800 なので、この帯は測っている画素に一切かからない。
//   node redact-shots.mjs <png...>
import { execFile } from 'node:child_process';
import { rename, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const BOX = { x: 200, y: 800, w: 840, h: 160 };
for (const file of process.argv.slice(2)) {
  const tmp = file + '.redacted.png';
  await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file,
    '-vf', `drawbox=x=${BOX.x}:y=${BOX.y}:w=${BOX.w}:h=${BOX.h}:color=black@1:t=fill`, tmp]);
  await unlink(file);
  await rename(tmp, file);
  console.log('redacted', file.split('/').pop());
}
