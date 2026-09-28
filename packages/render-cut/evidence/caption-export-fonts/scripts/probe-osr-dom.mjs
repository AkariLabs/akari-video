// OSR のページ（page-builder + static-server の実物）を Electron で開き、字幕 iframe の
// document.fonts・各字幕の computed font-family・@font-face の読み込み成否・失敗リクエストを記録する検証専用スクリプト。
// 使い方: electron probe-osr-dom.mjs <repo-root> <project-root> <out.json>
import { app, BrowserWindow, session } from 'electron';
import { writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, projectRoot, outPath] = process.argv.slice(-3).map(p => resolve(p));
async function main() {
const { loadAndBuildOsrPage } = await import(pathToFileURL(join(repo, 'packages/osr-export/src/page-builder.mjs')).href);
const { startStaticServer } = await import(pathToFileURL(join(repo, 'packages/osr-export/src/static-server.mjs')).href);
console.error('stage: start');
console.error('stage: ready');
const built = await loadAndBuildOsrPage({ projectRoot, stampRow: true });
const fontPath = join(repo, 'assets/font/noto-sans-jp/NotoSansJP-Variable.ttf');
const server = await startStaticServer({ pageHtml: built.html, overlaySheetHtml: built.overlaySheetHtml, projectRoot,
  captionFontPath: existsSync(fontPath) ? fontPath : null });
const failed = [], requests = [], consoleLines = [];
session.defaultSession.webRequest.onErrorOccurred(d => failed.push({ url: d.url.slice(0, 200), error: d.error }));
session.defaultSession.webRequest.onCompleted(d => { if (/font|\.ttf|\.otf|woff/i.test(d.url)) requests.push({ url: d.url.slice(0, 200), status: d.statusCode }); });
const win = new BrowserWindow({ show: false, width: 1280, height: 721, webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: false } });
win.webContents.on('console-message', (_e, level, message) => consoleLines.push({ level, message: String(message).slice(0, 300) }));
console.error('stage: load', server.url);
win.loadURL(server.url).catch(e => console.error('load error', e));
await new Promise(r => win.webContents.once('did-finish-load', r));
console.error('stage: loaded');
await new Promise(r => setTimeout(r, 1500));
const result = await win.webContents.executeJavaScript(`(async () => {
  const frame = document.getElementById('akari-overlays');
  const doc = frame?.contentDocument;
  if (!doc) return { error: 'no overlay iframe' };
  const cues = [...doc.querySelectorAll('.akari-caption')];
  const faceRules = [];
  for (const sheet of doc.styleSheets) { try { for (const rule of sheet.cssRules) if (rule instanceof CSSFontFaceRule)
    faceRules.push({ family: rule.style.getPropertyValue('font-family'), weight: rule.style.getPropertyValue('font-weight'), src: rule.style.getPropertyValue('src').slice(0, 140) }); } catch {} }
  const uniqueFaces = [...new Map(faceRules.map(f => [f.family + '|' + f.weight + '|' + f.src, f])).values()];
  const perCue = [];
  for (const cue of cues) {
    const host = cue.closest('[data-overlay-id]') || cue.parentElement;
    const line = cue.querySelector('.akari-caption__line') || cue;
    const cs = getComputedStyle(line);
    const family = cs.fontFamily, weight = cs.fontWeight;
    let loaded = [];
    try { loaded = await doc.fonts.load(weight + ' 64px ' + family, '今日のまとめ Abc'); } catch (e) { loaded = String(e); }
    perCue.push({ overlay: host?.getAttribute('data-overlay-id') ?? null, family, weight,
      fontsLoadMatched: Array.isArray(loaded) ? loaded.map(f => f.family + ' ' + f.weight + ' ' + f.status) : loaded,
      check: doc.fonts.check(weight + ' 64px ' + family, '今日') });
  }
  await doc.fonts.ready;
  const fontSet = [...doc.fonts].map(f => ({ family: f.family, weight: f.weight, status: f.status }));
  return { captionCount: cues.length, faceRules: uniqueFaces, perCue, fontSet };
})()`);
console.error('stage: evaluated');
writeFileSync(outPath, JSON.stringify({ ...result, failedRequests: failed, fontRequests: requests,
  console: consoleLines.slice(0, 40), warnings: built.warnings }, null, 2));
await server.close();
app.exit(0);
}
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(main).catch(e => { console.error(e); app.exit(1); });
