'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let port = null;
let nextId = 1;
const pending = new Map();
let resolvePort;
let sharedBuffer = null;
const portReady = new Promise(resolve => { resolvePort = resolve; });

ipcRenderer.on('benchmark:port', event => {
  port = event.ports[0];
  port.onmessage = message => {
    const resolver = pending.get(message.data.id);
    if (resolver) {
      pending.delete(message.data.id);
      resolver(message.data);
    }
  };
  port.start();
  resolvePort();
});

async function portRoundTrip(bytes, shared) {
  await portReady;
  const id = nextId++;
  let payload;
  let transfer = [];
  if (shared && typeof SharedArrayBuffer !== 'undefined') {
    if (!sharedBuffer || sharedBuffer.byteLength !== bytes.byteLength) {
      sharedBuffer = new SharedArrayBuffer(bytes.byteLength);
    }
    new Uint8Array(sharedBuffer).set(bytes);
    payload = { id, kind: 'shared', buffer: sharedBuffer };
  } else {
    const copy = Uint8Array.from(bytes);
    payload = { id, kind: 'transfer', buffer: copy.buffer };
    transfer = [copy.buffer];
  }
  const result = new Promise(resolve => pending.set(id, resolve));
  port.postMessage(payload, transfer);
  return result;
}

contextBridge.exposeInMainWorld('frameBench', {
  fixtureUrl: 'frame-engine-bench://fixture/source-1080p.mp4',
  startRawEncoder: options => ipcRenderer.invoke('benchmark:raw-start', options),
  writeRawFrame: bytes => ipcRenderer.invoke('benchmark:raw-frame', bytes),
  finishRawEncoder: () => ipcRenderer.invoke('benchmark:raw-finish'),
  startH264Mux: options => ipcRenderer.invoke('benchmark:h264-start', options),
  writeH264Chunk: bytes => ipcRenderer.invoke('benchmark:h264-chunk', bytes),
  finishH264Mux: () => ipcRenderer.invoke('benchmark:h264-finish'),
  invokeRoundTrip: bytes => ipcRenderer.invoke('benchmark:invoke-roundtrip', bytes),
  portRoundTrip,
  runRenderCut: () => ipcRenderer.invoke('benchmark:render-cut'),
  psnr: () => ipcRenderer.invoke('benchmark:psnr'),
  complete: result => ipcRenderer.invoke('benchmark:complete', result),
  fail: message => ipcRenderer.invoke('benchmark:fail', message)
});
