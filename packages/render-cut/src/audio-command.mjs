import { basename, isAbsolute, relative } from 'node:path';
import { parseAudioToolVersion } from './audio-qc.mjs';

export function parseFfmpegMajorVersion(line) {
  if (!parseAudioToolVersion(line) || !String(line).startsWith('ffmpeg version ')) return null;
  const match = /^ffmpeg version\s+n?(\d+)(?:\.|-|\s|$)/u.exec(String(line ?? ''));
  if (match && Number(match[1]) >= 2000) return null; // date-based git build
  return match ? Number(match[1]) : null;
}

export function filterGraphFileOption(versionLine) {
  if (!parseAudioToolVersion(versionLine) || !String(versionLine).startsWith('ffmpeg version ')) return null;
  const major = parseFfmpegMajorVersion(versionLine);
  return major === null || major >= 7 ? '-/filter_complex' : '-filter_complex_script';
}

export function audioCommandLength(command, args) {
  // Conservative CreateProcess estimate, including quoting and separators.
  return [command, ...args].reduce((length, argument) => length + String(argument).length + 3, 0);
}

export function countAudioItems(audio) {
  return (Array.isArray(audio?.narration) ? audio.narration.length : 0)
    + (Array.isArray(audio?.speech) ? audio.speech.length : 0)
    + (audio?.bgm ? 1 : 0)
    + (Array.isArray(audio?.sfx) ? audio.sfx.length : 0);
}

export function prepareAudioMixExecution(audioPlan, { ffmpegVersion, graphPath, projectRoot, audioItemCount = 0, limit = process.platform === 'win32' ? 32767 : 131072 } = {}) {
  const args = [...audioPlan.args];
  const graphIndex = args.indexOf('-filter_complex');
  let filterGraph = null;
  const fileOption = filterGraphFileOption(ffmpegVersion);
  if (graphIndex >= 0 && fileOption) {
    if (!graphPath) throw new Error('audio filter graph path is required');
    filterGraph = args[graphIndex + 1];
    args.splice(graphIndex, 2, fileOption, graphPath);
  }
  // Windows: CreateProcess limits the full line to 32,767 UTF-16 units. Elsewhere use
  // Linux MAX_ARG_STRLEN (131,072 bytes for one argument) as a conservative bound.
  const shorterProjectPath = value => {
    if (!isAbsolute(value)) return value;
    const candidate = relative(projectRoot, value);
    const safe = candidate.startsWith('-') ? `./${candidate}` : candidate;
    return safe.length < value.length ? safe : value;
  };
  if (projectRoot) {
    for (let index = 0; index < args.length; index++) {
      if ((args[index] === '-i' || args[index] === '-/filter_complex' || args[index] === '-filter_complex_script')
        && isAbsolute(args[index + 1])) args[index + 1] = shorterProjectPath(args[index + 1]);
    }
    if (isAbsolute(args.at(-1))) args[args.length - 1] = shorterProjectPath(args.at(-1));
  }
  const length = audioCommandLength(audioPlan.command, args);
  if (length >= limit) {
    throw new Error(`音声アイテム ${audioItemCount} 個でコマンドが ${length} 文字になり上限 ${limit} 文字を超えた。効果音をステムにまとめてください`);
  }
  return { args, filterGraph, graphFilename: filterGraph === null ? null : basename(graphPath), commandLength: length };
}
