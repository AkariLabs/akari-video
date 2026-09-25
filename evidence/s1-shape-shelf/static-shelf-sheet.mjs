#!/usr/bin/env node
// 検証専用（実機の代わりではない）: 本物の棚コンポーネント（LibraryShapeShelf）を react-dom/server で描き、
// 行ごとの見本の SVG を取り出して 1 枚の SVG シートに並べる。rsvg-convert で PNG にして、見本の形と色
// （暗い背景 = 白・明るい背景 = 黒）を目で確かめる。レイアウト（左右スライド・ボタン）は実機で確かめる。
// 使い方: node evidence/s1-shape-shelf/static-shelf-sheet.mjs --shell <apps/shell> --out <出力 dir>

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const argument = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const shellDir = path.resolve(argument('shell'));
const outDir = path.resolve(argument('out', '.'));
await mkdir(outDir, { recursive: true });
const require = createRequire(path.join(shellDir, 'package.json'));
const React = require('@theia/core/shared/react');
const { renderToStaticMarkup } = require('react-dom/server');
const { LibraryShapeShelf } = require(path.join(shellDir, 'extensions/akari-project/lib/browser/library-shape-shelf-view.js'));
const { parseShapeShelfJsonl, pushRecentShape } = require(path.join(shellDir, 'extensions/akari-project/lib/common/shape-shelf.js'));
const presets = parseShapeShelfJsonl(await readFile(path.join(shellDir, '../../presets/shapes/index.jsonl'), 'utf8'));
const recent = ['star-5', 'heart-heart', 'line-dash-tri-tri', 'manga-shout'].reduce((list, id) => pushRecentShape(list, id), []);
const noop = () => undefined;

function markup(view) {
  return renderToStaticMarkup(React.createElement(LibraryShapeShelf, {
    presets, recent, loaded: true, query: '', view, onBack: noop, onShowAll: noop, onPlace: noop, onDragStart: noop, onDragEnd: noop,
  }));
}

/** 行（section）ごとに [ラベル, [svg...]] を取り出す。 */
function rowsOf(html) {
  const rows = [];
  for (const section of html.split('<section').slice(1)) {
    const label = section.match(/<strong[^>]*>([^<]*)<\/strong>/)?.[1] ?? '';
    const svgs = [...section.matchAll(/<button[^>]*data-akari-shape-kind="(\w+)"[^>]*>(<svg[\s\S]*?<\/svg>)<\/button>/g)]
      .map(match => ({ kind: match[1], svg: match[2] }));
    rows.push({ label, svgs });
  }
  return rows;
}

function sheet(rows, theme, perRow) {
  const ink = theme === 'dark' ? '#ffffff' : '#000000';
  const bg = theme === 'dark' ? '#0f0f0f' : '#fafafa';
  const muted = theme === 'dark' ? '#a3a3a3' : '#525252';
  const cell = 62; const lineCell = 84; const labelH = 22; const rowH = labelH + cell + 8;
  const width = 16 + perRow * lineCell;
  let y = 12; let body = '';
  for (const row of rows) {
    body += `<text x="10" y="${y + 15}" font-family="Hiragino Sans, sans-serif" font-size="12.5" font-weight="700" fill="${ink}">${row.label}</text>`;
    if (row.label) body += `<text x="${width - 10}" y="${y + 15}" text-anchor="end" font-family="Hiragino Sans, sans-serif" font-size="11" fill="${muted}">すべて表示</text>`;
    let x = 8;
    for (const item of row.svgs.slice(0, perRow + 2)) {
      const w = item.kind === 'line' ? lineCell : cell;
      if (x + w > width) break;
      const inner = item.svg.replace('<svg ', `<svg x="${x + (w - (item.kind === 'line' ? 76 : 50)) / 2}" y="${y + labelH + (cell - (item.kind === 'line' ? 26 : 50)) / 2}" `);
      body += `<g color="${ink}">${inner}</g>`;
      x += w + 2;
    }
    y += rowH;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y + 8}" viewBox="0 0 ${width} ${y + 8}"><rect width="100%" height="100%" fill="${bg}"/>${body}</svg>`;
}

const report = {};
for (const theme of ['dark', 'light']) {
  const shelf = rowsOf(markup(undefined));
  const svgFile = path.join(outDir, `static-shelf-${theme}.svg`);
  await writeFile(svgFile, sheet(shelf, theme, 4));
  execFileSync('rsvg-convert', ['-z', '2', '-o', svgFile.replace(/\.svg$/, '.png'), svgFile]);
  report[theme] = shelf.map(row => ({ label: row.label, tiles: row.svgs.length }));
}
// ラインの「すべて表示」（45 本）
const lines = markup('line');
const lineSvgs = [...lines.matchAll(/<button[^>]*data-akari-shape-kind="line"[^>]*>(<svg[\s\S]*?<\/svg>)<\/button>/g)].map(match => ({ kind: 'line', svg: match[1] }));
const lineRows = [];
for (let i = 0; i < lineSvgs.length; i += 3) lineRows.push({ label: i === 0 ? 'ライン（すべて表示）' : '', svgs: lineSvgs.slice(i, i + 3) });
const lineSvgFile = path.join(outDir, 'static-lines-all-dark.svg');
await writeFile(lineSvgFile, sheet(lineRows, 'dark', 3));
execFileSync('rsvg-convert', ['-z', '2', '-o', lineSvgFile.replace(/\.svg$/, '.png'), lineSvgFile]);
report.linesAll = lineSvgs.length;
await writeFile(path.join(outDir, 'static-sheet.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
