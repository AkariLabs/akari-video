import fs from 'node:fs';
import path from 'node:path';
import { resolveFfmpeg, resolveFfprobe } from '../../../../../../packages/media-bin/src/index.mjs';

export const FFMPEG_SKIP_REASON = 'ffmpeg/ffprobe 不在（unit-media 相当の環境でのみ実行）';

function executable(command) {
  const candidates = command.includes(path.sep)
    ? [command]
    : (process.env.PATH ?? '').split(path.delimiter).map(directory => path.join(directory, command));
  return candidates.some(candidate => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

export function requireFfmpeg(t) {
  try {
    if (executable(resolveFfmpeg()) && executable(resolveFfprobe())) return true;
  } catch { /* binary resolution failed */ }
  t.skip(FFMPEG_SKIP_REASON);
  return false;
}
