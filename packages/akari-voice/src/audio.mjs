import { t } from '../../i18n/index.mjs';
import { spawnSync } from 'node:child_process';

export const AUDIO_TOO_LONG_MESSAGE = t('tools.voice.engine.error.audioTooLong');

export function isAudioBufferLimit(error) {
  return error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || error?.code === 'ENOBUFS'
    || /maxBuffer/i.test(error?.message ?? '');
}

export function decodeAudio16k({ ffmpeg = 'ffmpeg', file, start, duration }) {
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (start !== undefined) args.push('-ss', String(start));
  args.push('-i', file);
  if (duration !== undefined) args.push('-t', String(duration));
  args.push('-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1');
  const result = spawnSync(ffmpeg, args, { encoding: 'buffer', maxBuffer: 1024 * 1024 * 512 });
  if (isAudioBufferLimit(result.error)) throw new Error(AUDIO_TOO_LONG_MESSAGE);
  if (result.error || result.status !== 0) throw new Error(t('tools.voice.engine.error.audioLoadFailed', { message: result.error?.message || result.stderr.toString('utf8').trim() }));
  if (result.stdout.length % 4) throw new Error(t('tools.voice.engine.error.invalidAudioLength'));
  const bytes = new Uint8Array(result.stdout.length);
  bytes.set(result.stdout);
  return new Float32Array(bytes.buffer);
}

export function sliceSeconds(samples, start, end, sampleRate = 16000) {
  const from = Math.max(0, Math.min(samples.length, Math.round(start * sampleRate)));
  const to = Math.max(from, Math.min(samples.length, Math.round(end * sampleRate)));
  return samples.subarray(from, to);
}

export function concatTurnsAudio(samples, turns, offsetSeconds = 0) {
  const chunks = turns.map(turn => sliceSeconds(samples, turn.start - offsetSeconds, turn.end - offsetSeconds));
  const result = new Float32Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
