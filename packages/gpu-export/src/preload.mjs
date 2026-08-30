import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("akariGpu", {
  config: () => ipcRenderer.invoke("gpu:config"),
  log: (message) => ipcRenderer.invoke("gpu:log", String(message)),
  checkpoint: (value) => ipcRenderer.invoke("gpu:checkpoint", value),
  startChunks: (value) => ipcRenderer.invoke("gpu:chunks-start", value),
  writeChunk: (value) => ipcRenderer.invoke("gpu:chunk", value),
  finishChunks: (value) => ipcRenderer.invoke("gpu:chunks-finish", value),
  writeCaptureFrame: (value) => ipcRenderer.invoke("gpu:capture-frame", value),
});
