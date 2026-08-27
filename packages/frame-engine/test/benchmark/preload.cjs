'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let port = null;
let nextId = 1;
const pending = new Map();
let resolvePort;
const portReady = new Promise(resolve => { resolvePort = resolve; });

function withTimeout(promise, timeoutMs, label, onTimeout) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function invoke(channel, timeoutMs, ...args) {
  return withTimeout(ipcRenderer.invoke(channel, ...args), timeoutMs, channel);
}

ipcRenderer.on('benchmark:port', event => {
  port = event.ports[0];
  port.onmessage = message => {
    const id = message.data?.id;
    const resolver = pending.get(id);
    if (resolver) {
      pending.delete(id);
      resolver(message.data);
    }
  };
  port.start();
  resolvePort();
});

async function portRoundTrip(bytes) {
  await withTimeout(portReady, 10_000, 'MessagePortMain setup');
  const id = nextId++;
  const copy = Uint8Array.from(bytes);
  const result = new Promise(resolve => pending.set(id, resolve));
  port.postMessage({ id, kind: 'copy', buffer: copy.buffer });
  return withTimeout(result, 30_000, 'MessagePortMain copy round trip', () => pending.delete(id));
}

contextBridge.exposeInMainWorld('frameBench', {
  fixtureUrl: 'frame-engine-bench://fixture/source-1080p.mp4',
  workerUrl: 'frame-engine-bench://app/ipc-worker.js',
  startRawEncoder: options => invoke('benchmark:raw-start', 30_000, options),
  writeRawFrame: bytes => invoke('benchmark:raw-frame', 120_000, bytes),
  finishRawEncoder: () => invoke('benchmark:raw-finish', 120_000),
  startH264Mux: options => invoke('benchmark:h264-start', 30_000, options),
  writeH264Chunk: bytes => invoke('benchmark:h264-chunk', 120_000, bytes),
  finishH264Mux: () => invoke('benchmark:h264-finish', 120_000),
  abortEncoder: () => invoke('benchmark:encoder-abort', 10_000),
  invokeRoundTrip: bytes => invoke('benchmark:invoke-roundtrip', 30_000, bytes),
  portRoundTrip,
  runRenderCut: () => invoke('benchmark:render-cut', 900_000),
  psnr: () => invoke('benchmark:psnr', 300_000),
  complete: result => invoke('benchmark:complete', 10_000, result),
  fail: message => invoke('benchmark:fail', 10_000, message)
});
