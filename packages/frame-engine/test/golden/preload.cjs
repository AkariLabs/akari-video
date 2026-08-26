'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('goldenHarness', {
  fixtureUrl: 'frame-engine://fixture/source.mp4',
  writeArtifact: (name, bytes) => ipcRenderer.invoke('golden:artifact', name, bytes),
  startEncoder: (options) => ipcRenderer.invoke('golden:encoder-start', options),
  writeEncoderFrame: (bytes) => ipcRenderer.invoke('golden:encoder-frame', bytes),
  finishEncoder: () => ipcRenderer.invoke('golden:encoder-finish'),
  complete: (result) => ipcRenderer.invoke('golden:complete', result),
  fail: (message) => ipcRenderer.invoke('golden:fail', message)
});
