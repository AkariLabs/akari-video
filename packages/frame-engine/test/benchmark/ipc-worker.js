'use strict';

self.onmessage = event => {
  if (event.data?.kind !== 'connect' || !event.ports[0]) return;
  const port = event.ports[0];
  port.onmessage = message => {
    const value = message.data;
    if (!value || typeof value !== 'object') {
      port.postMessage({ id: null, length: 0, error: 'worker received invalid data' });
      return;
    }
    const buffer = value.buffer;
    const response = {
      id: value.id,
      kind: value.kind,
      length: buffer?.byteLength ?? 0,
      shared: typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer,
      buffer
    };
    if (value.kind === 'array-buffer-transfer' && buffer instanceof ArrayBuffer) {
      port.postMessage(response, [buffer]);
    } else {
      port.postMessage(response);
    }
  };
  port.start();
};
