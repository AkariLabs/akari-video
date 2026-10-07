import { EventEmitter } from 'node:events';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function wavHeader(bytes) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(bytes, 40);
  return header;
}

export function createRecordEngine({ transcribe, tmpDir = tmpdir() } = {}) {
  const events = new EventEmitter();
  events.on('error', () => {});
  let directory;
  let handle;
  let bytes = 0;
  let stopped = false;
  let cancelled = false;
  let stopPromise;
  const controller = new AbortController();
  const available = typeof transcribe === 'function';

  async function start() {
    if (!available || directory || stopped) return;
    directory = await mkdtemp(join(tmpDir, 'akari-ear-'));
    try {
      handle = await open(join(directory, 'audio.wav'), 'w');
      await handle.write(wavHeader(0), 0, 44, 0);
    } catch (error) {
      await handle?.close().catch(() => {});
      handle = undefined;
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
      throw error;
    }
    events.emit('status', { state: 'listening', message: '録音しています。止めたあとで文字にします' });
  }

  async function appendAudio(pcm16le) {
    if (stopped || cancelled) return;
    if (!Buffer.isBuffer(pcm16le)) throw new TypeError('PCM16LE は Buffer が必要です');
    if (pcm16le.length % 2) throw new RangeError('PCM16LE の長さが不正です');
    try {
      await start();
      if (!handle) return;
      await handle.write(pcm16le, 0, pcm16le.length, 44 + bytes);
      bytes += pcm16le.length;
    } catch (error) {
      await cancel();
      throw error;
    }
  }

  function stop() {
    if (stopPromise) return stopPromise;
    stopped = true;
    stopPromise = (async () => {
      try {
        if (!available || cancelled) return;
        if (!handle) {
          directory = await mkdtemp(join(tmpDir, 'akari-ear-'));
          handle = await open(join(directory, 'audio.wav'), 'w');
        }
        await handle.write(wavHeader(bytes), 0, 44, 0);
        await handle.close();
        handle = undefined;
        if (cancelled) return;
        events.emit('status', { state: 'stopping', message: '文字にしています…' });
        const result = await transcribe(join(directory, 'audio.wav'), { signal: controller.signal });
        if (!cancelled) {
          if (result?.backend) events.emit('backend', result.backend);
          for (const segment of result?.segments ?? []) {
            events.emit('final', { ...segment, t: segment.t1, final: true });
          }
        }
      } catch (error) {
        if (!cancelled) events.emit('error', error);
      } finally {
        await handle?.close().catch(() => {});
        handle = undefined;
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    })();
    return stopPromise;
  }

  function cancel() {
    if (cancelled) return stopPromise ?? Promise.resolve();
    cancelled = true;
    controller.abort();
    return stop();
  }

  return { available, on: events.on.bind(events), start, appendAudio, stop, cancel };
}
