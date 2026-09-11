// L1 用の最小 Electron アプリ（検証専用・製品コードではない）。
// preview-server の Web UI（<video> 要素経路 = ?frameEngine=0）を実 Electron（GPU 有効）の
// BrowserWindow で開くだけ。操作はすべて --remote-debugging-port 経由の CDP で行う。
// shell（Theia）は起動しない: スパイクの試作は packages/preview-server/public/app.js にだけあり、
// shell の webview 複製には入っていないため（契約「ファイル境界」）。
const { app, BrowserWindow } = require('electron');

const url = process.env.AKARI_SCRUB_URL || 'about:blank';
// 自動再生ポリシー: ユーザー操作なしで AudioContext / media.play() を許可する（計測のため）。
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    webPreferences: {
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });
  win.loadURL(url);
});
app.on('window-all-closed', () => app.quit());
