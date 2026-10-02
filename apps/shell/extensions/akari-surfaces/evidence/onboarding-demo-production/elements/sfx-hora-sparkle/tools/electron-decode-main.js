// Electron の decodeAudioData（プレビューと同じ Chromium のデコーダ）で m4a を復号し、float32 を書き出す
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const [file, out] = process.argv.slice(-2);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const b64 = fs.readFileSync(file).toString('base64');
  const res = await win.webContents.executeJavaScript(`(async () => {
    const bin = Uint8Array.from(atob('${b64}'), c => c.charCodeAt(0));
    const ctx = new OfflineAudioContext(2, 48000, 48000);
    const buf = await ctx.decodeAudioData(bin.buffer);
    const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const inter = new Float32Array(buf.length * 2);
    for (let i = 0; i < buf.length; i++) { inter[2*i] = L[i]; inter[2*i+1] = R[i]; }
    let s = ''; const u8 = new Uint8Array(inter.buffer);
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { length: buf.length, sampleRate: buf.sampleRate, channels: buf.numberOfChannels, data: btoa(s) };
  })()`);
  fs.writeFileSync(out, Buffer.from(res.data, 'base64'));
  fs.writeFileSync(out + '.json', JSON.stringify({ length: res.length, sampleRate: res.sampleRate, channels: res.channels, electron: process.versions.electron, chrome: process.versions.chrome }));
  app.exit(0);
});
