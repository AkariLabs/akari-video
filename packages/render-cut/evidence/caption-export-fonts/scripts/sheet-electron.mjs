// sheet-electron.mjs <out.png> <rows.json> <label>=<frames-dir> ... : 字幕帯を切り出した比較画像を HTML で組んで Electron で撮る（検証専用）。
// 列の後ろに「=psnr:<基準列番号>」を付けると、基準列との PSNR（字幕帯・参考値）を各セルに書く（psnr.json から）。
import { app, BrowserWindow } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const args = process.argv.slice(process.argv.findIndex(a => a.endsWith('sheet-electron.mjs')) + 1);
const [outArg, rowsFile, ...cols] = args; const out = path.resolve(process.env.SHEET_CWD, outArg);
const rows = JSON.parse(readFileSync(path.resolve(process.env.SHEET_CWD, rowsFile), 'utf8'));
const notes = existsSync(out + '.notes.json') ? JSON.parse(readFileSync(out + '.notes.json', 'utf8')) : {};
const columns = cols.map(c => { const i = c.indexOf('='); return { label: c.slice(0, i), dir: path.resolve(process.env.SHEET_CWD, c.slice(i + 1)) }; });
const W = 480, H = 70;
const cell = (dir, r) => { const f = path.join(dir, `cue-${String(r + 1).padStart(2, '0')}.png`);
  return existsSync(f) ? `<div class="c"><div class="crop" style="background-image:url('${pathToFileURL(f).href}')"></div>${notes[`${dir}|${r}`] ? `<span class="n">${notes[`${dir}|${r}`]}</span>` : ''}</div>` : `<div class="c empty">(no output)</div>`; };
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#111;color:#eee;font:14px sans-serif}
table{border-collapse:collapse}td,th{padding:2px 4px;border-bottom:1px solid #333;vertical-align:middle}th{text-align:left;font-weight:600}
.c{position:relative;width:${W}px;height:${H}px}.crop{width:${W}px;height:${H}px;background-size:${1280 / 2}px ${720 / 2}px;background-position:-${160 / 2}px -${545 / 2}px}
.empty{display:flex;align-items:center;justify-content:center;background:#444}.n{position:absolute;right:4px;bottom:2px;font-size:11px;background:#000a;padding:0 3px}
.l{width:230px;font-size:13px}</style><table><tr><th class="l">cue</th>${columns.map(c => `<th>${c.label}</th>`).join('')}</tr>
${rows.map((label, r) => `<tr><td class="l">${String(r + 1).padStart(2, '0')} ${label}</td>${columns.map(c => `<td>${cell(c.dir, r)}</td>`).join('')}</tr>`).join('\n')}</table>`;
const htmlPath = out + '.html';
writeFileSync(htmlPath, html);
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  const width = 250 + columns.length * (W + 9), height = 30 + rows.length * (H + 5);
  const win = new BrowserWindow({ show: false, width, height, webPreferences: { offscreen: true } });
  await win.loadFile(htmlPath);
  await new Promise(r => setTimeout(r, 800));
  const image = await win.webContents.capturePage();
  writeFileSync(out, image.toPNG());
  app.exit(0);
});
