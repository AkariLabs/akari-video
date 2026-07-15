'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bench', {
  log: (msg) => ipcRenderer.invoke('bench:log', msg),
  screenshot: (name) => ipcRenderer.invoke('bench:screenshot', name),
  sysmetrics: (label) => ipcRenderer.invoke('bench:sysmetrics', label),
  results: (json) => ipcRenderer.invoke('bench:results', json),
  quit: () => ipcRenderer.invoke('bench:quit'),
});
