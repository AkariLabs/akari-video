'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('seekHarness', {
  fixtureUrl: 'frame-engine-seek://fixture/source.mp4',
  complete: value => ipcRenderer.invoke('seek:complete', value),
  fail: message => ipcRenderer.invoke('seek:fail', message),
});
