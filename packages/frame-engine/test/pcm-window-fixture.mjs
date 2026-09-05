import assert from 'node:assert/strict';

export const sampleRate = 24000;
export const pcm = new ArrayBuffer(120 * sampleRate * 2);
const view = new DataView(pcm);
for (let frame = 0; frame < 120 * sampleRate; frame += 1) {
  const frequency = 137 + Math.floor(frame / (10 * sampleRate)) * 41;
  view.setInt16(frame * 2, Math.round(28000 * Math.sin(2 * Math.PI * frequency * frame / sampleRate)), true);
}

export function metadata(durationSec = 120, url = '/audio.pcm') {
  return { url, sampleRate, channels: 1, bytesPerSample: 2, frames: durationSec * sampleRate, durationSec };
}

export function expectedSamples(startFrame, frameCount) {
  return Float32Array.from({ length: frameCount }, (_, index) =>
    view.getInt16(((startFrame + index) % (pcm.byteLength / 2)) * 2, true) / 32768);
}

// Long seek fixtures repeat the same 120-second PCM; only requested bytes are copied.
export function rangeServer({ durationSec = 120, requireRange = false, beforeResponse = async () => {} } = {}) {
  const requests = [];
  const total = durationSec * sampleRate * 2;
  const fetchImpl = async (url, options = {}) => {
    const range = new Headers(options.headers).get('Range');
    const request = { url, range, signal: options.signal, reads: 0, cancels: 0 };
    requests.push(request);
    if (requireRange) assert.ok(range, 'PCM fetch must carry Range');
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? '');
    request.start = match ? Number(match[1]) : 0;
    request.end = match ? Math.min(Number(match[2]), total - 1) : total - 1;
    request.status = !range ? 200 : !match || request.start >= total || request.end < request.start ? 416 : 206;
    await beforeResponse(request);
    return {
      status: request.status,
      ok: request.status >= 200 && request.status < 300,
      headers: new Headers({ 'Content-Range': `bytes ${request.start}-${request.end}/${total}` }),
      body: { cancel: async () => { request.cancels += 1; } },
      arrayBuffer: async () => {
        request.reads += 1;
        const bytes = new Uint8Array(request.status === 416 ? 0 : request.end - request.start + 1);
        const original = new Uint8Array(pcm);
        for (let offset = 0; offset < bytes.length;) {
          const start = (request.start + offset) % original.length;
          const count = Math.min(bytes.length - offset, original.length - start);
          bytes.set(original.subarray(start, start + count), offset);
          offset += count;
        }
        request.bodyBytes = bytes.length;
        return bytes.buffer;
      },
    };
  };
  return { fetchImpl, requests };
}

export function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

export async function flush() {
  for (let index = 0; index < 300; index += 1) await Promise.resolve();
}

// Advance timer time independently of AudioContext time (e.g. stalled/late fetches).
export function fakeClock(t) {
  let now = 0;
  let id = 0;
  const timers = new Map();
  t.mock.method(globalThis, 'setTimeout', (callback, delay = 0) => {
    timers.set(++id, { callback, at: now + delay });
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', key => timers.delete(key));
  return {
    now: () => now,
    pending: () => timers.size,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}
