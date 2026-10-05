import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// 読み先リスト（固定順）。extensionRoot（= test/helpers/ の 2 つ上）の src/browser/ 基準。
// daihon widget を分割して CSS・定数・class のメンバが別ファイルへ出たら、出た先をここに 1 行足す。
// className の無いエントリは class の検査と findMember から外れ、全文には入る。
export const DAIHON_SOURCE_FILES = [
  { key: 'widget', path: 'daihon/akari-daihon-widget.ts', className: 'AkariDaihonWidget' },
];

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// 合成ファイルを使う永続テスト専用の差し替え口。本番のテストは既定値を使う。
const rootOf = options => options.extensionRoot ?? defaultRoot;
const filesOf = options => options.files ?? DAIHON_SOURCE_FILES;
const sourceCache = new Map();
const label = entry => `${entry.key} (${entry.className})`;

function sourceEntry(entry, options) {
  const path = join(rootOf(options), 'src/browser', entry.path);
  let text;
  try { text = readFileSync(path, 'utf8'); }
  catch (error) { throw new Error(`Daihon source ${entry.key} が読めません: ${path}: ${error.message}`, { cause: error }); }
  if (!text) throw new Error(`Daihon source ${entry.key} が空です: ${path}`);
  const cached = sourceCache.get(path);
  if (cached?.text === text && cached.className === entry.className && cached.key === entry.key) return cached;
  const ast = ts.createSourceFile(basename(path), text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let classNode;
  if (entry.className) {
    const classes = ast.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === entry.className);
    if (classes.length !== 1) throw new Error(`Daihon source ${path}: ${entry.className} は 1 class 必須です (found ${classes.length})`);
    classNode = classes[0];
  }
  const result = { key: entry.key, path, className: entry.className, text, ast, classNode };
  sourceCache.set(path, result);
  return result;
}

export function readDaihonSources(options = {}) {
  const files = filesOf(options);
  const seen = new Set();
  for (const entry of files) {
    if (seen.has(entry.key)) throw new Error(`Daihon source key が重複しています: ${entry.key} (${entry.path})`);
    seen.add(entry.key);
  }
  return files.map(entry => sourceEntry(entry, options));
}

export function readSourceFile(key, options = {}) {
  const entries = readDaihonSources(options);
  const entry = entries.find(item => item.key === key);
  if (!entry) throw new Error(`未登録の Daihon source key: ${key}`);
  return entry;
}

export function readAllSourceText(options = {}) {
  return readDaihonSources(options).map(entry => entry.text).join('\n');
}

function candidates(options) {
  const entries = readDaihonSources(options);
  if (options.in !== undefined && !entries.some(entry => entry.key === options.in)) {
    throw new Error(`未登録の Daihon source key: ${options.in}`);
  }
  return entries;
}

export function findMember(name, options = {}) {
  const entries = candidates(options);
  const matches = entries.flatMap(entry => entry.classNode?.members
    .filter(node => node.name?.getText(entry.ast) === name)
    .map(node => ({ key: entry.key, className: entry.className, path: entry.path, ast: entry.ast, node, text: node.getText(entry.ast) })) ?? []);
  const selected = options.in === undefined ? matches : matches.filter(item => item.key === options.in);
  if (selected.length === 0) {
    if (options.in !== undefined && matches.length) {
      const expected = entries.find(entry => entry.key === options.in);
      const locations = [...new Set(matches.map(item => label(item)))].join('、');
      throw new Error(`${name} は ${label(expected)} にありません。${locations} にあります（探したファイル: ${expected.path}）`);
    }
    throw new Error(`${name} はどの class にもありません（探した先: ${entries.map(entry => `${entry.key} ${entry.path}`).join(', ')}）`);
  }
  if (selected.length > 1) {
    const locations = [...new Set(selected.map(item => `${label(item)} ${item.path}`))].join('、');
    throw new Error(`${name} は ${selected.length} 件あります: ${locations}。{ in: '<key>' } で場所を指定してください`);
  }
  return selected[0];
}

export function memberText(name, options = {}) {
  return findMember(name, options).text;
}

export function sliceBetween(startAnchor, endAnchor, options = {}) {
  const entries = candidates(options).filter(entry => options.in === undefined || entry.key === options.in);
  const matches = entries.filter(entry => entry.text.includes(startAnchor));
  if (!matches.length) throw new Error(`start anchor not found: ${startAnchor}（探した先: ${entries.map(entry => entry.path).join(', ')}）`);
  if (matches.length > 1) throw new Error(`start anchor found in ${matches.length} files: ${startAnchor}（${matches.map(entry => entry.path).join(', ')}）`);
  const entry = matches[0];
  const start = entry.text.indexOf(startAnchor);
  const end = entry.text.indexOf(endAnchor, start + startAnchor.length);
  if (end < 0) {
    if (entry.text.includes(endAnchor)) throw new Error(`アンカーの順序が逆: ${entry.path}: ${startAnchor} → ${endAnchor}`);
    throw new Error(`end anchor not found in ${entry.path}: ${endAnchor} after ${startAnchor}`);
  }
  return entry.text.slice(start, end);
}
