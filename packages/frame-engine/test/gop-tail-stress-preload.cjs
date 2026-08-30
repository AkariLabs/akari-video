'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stressHarness', {
  fixtures: {
    source: 'frame-engine-stress://fixture/source.mp4',
    bframeTail: 'frame-engine-stress://fixture/bframe-tail-bf2-30.mp4',
    bframe: 'frame-engine-stress://fixture/bframe-bf2-30.mp4',
  },
  options: {
    trials: Number(process.env.AKARI_STRESS_TRIALS ?? 104),
    concurrency: Number(process.env.AKARI_STRESS_CONCURRENCY ?? 8),
  },
  complete: value => ipcRenderer.invoke('stress:complete', value),
  fail: message => ipcRenderer.invoke('stress:fail', message),
});
