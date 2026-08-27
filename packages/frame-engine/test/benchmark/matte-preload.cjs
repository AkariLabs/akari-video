'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('matteBenchmark', {
  complete: result => ipcRenderer.invoke('matte-benchmark:complete', result),
  fail: message => ipcRenderer.invoke('matte-benchmark:fail', String(message)),
});
