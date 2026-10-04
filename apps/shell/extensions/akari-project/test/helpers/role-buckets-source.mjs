import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// role-buckets widget と pane 群のソースを、テストが読む共通の入口にする。
// メンバは class と所在を保ったまま返し、移動時の pin の取り違えを検出する。
// this.host. → this. のような区別を消す正規化は入れない。メンバ本文の加工は呼び出し側が担う。

// 読み先リスト（固定順）。extensionRoot（= test/helpers/ の 2 つ上）基準。
// F-70 の手順 5・6 が新しい pane を作ったら、ここに 1 行足す（足し忘れは readRoleBucketsSources() が throw する）。
export const ROLE_BUCKETS_SOURCE_FILES = [
  { key: 'widget', base: 'akari-role-buckets-widget', className: 'AkariRoleBucketsWidget' },
  { key: 'outputs', base: 'akari-outputs-pane', className: 'AkariOutputsPane' },
  { key: 'materials', base: 'akari-materials-pane', className: 'AkariMaterialsPane' },
  { key: 'library', base: 'akari-library-pane', className: 'AkariLibraryPane' },
  { key: 'lint', base: 'akari-lint-pane', className: 'AkariLintPane' },
];

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourceName = entry => `${entry.base}.tsx`;
// options.extensionRoot は永続テストの合成ファイル専用の差し替え口。
const rootOf = options => options.extensionRoot ?? defaultRoot;
const sourceCache = new Map();
const label = entry => `${entry.key} (${entry.className})`;

function inventory(options = {}) {
  const browserDir = join(rootOf(options), 'src/browser');
  const files = readdirSync(browserDir);
  const actual = files.filter(name => /^akari-.*-pane\.tsx$/u.test(name));
  const expected = ROLE_BUCKETS_SOURCE_FILES.filter(entry => entry.key !== 'widget').map(sourceName);
  const missing = expected.filter(name => !actual.includes(name));
  const unregistered = actual.filter(name => !expected.includes(name));
  const widgetEntry = ROLE_BUCKETS_SOURCE_FILES.find(entry => entry.key === 'widget');
  if (!widgetEntry) throw new Error(`role-buckets source inventory ${browserDir}: widget key is not registered`);
  const widget = sourceName(widgetEntry);
  if (!files.includes(widget)) missing.push(widget);
  if (missing.length || unregistered.length) {
    throw new Error(`role-buckets source inventory ${browserDir}: missing ${missing.join(', ') || 'none'}; unregistered ${unregistered.join(', ') || 'none'}`);
  }
}

function entryFor(key) {
  const entry = ROLE_BUCKETS_SOURCE_FILES.find(item => item.key === key);
  if (!entry) throw new Error(`Unknown role-buckets source key: ${key}`);
  return entry;
}

function sourceEntry(entry, options) {
  const path = join(rootOf(options), 'src/browser', sourceName(entry));
  const text = readFileSync(path, 'utf8');
  if (!text) throw new Error(`Empty role-buckets source: ${path}`);
  const cached = sourceCache.get(path);
  if (cached?.text === text && cached.className === entry.className) {
    return { key: entry.key, path, className: entry.className, text, ast: cached.ast, classNode: cached.classNode };
  }
  const ast = ts.createSourceFile(basename(path), text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const classes = ast.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === entry.className);
  if (classes.length !== 1) throw new Error(`Expected one ${entry.className} in ${path}; found ${classes.length}`);
  sourceCache.set(path, { text, className: entry.className, ast, classNode: classes[0] });
  return { key: entry.key, path, className: entry.className, text, ast, classNode: classes[0] };
}

export function readRoleBucketsSources(options = {}) {
  inventory(options);
  return ROLE_BUCKETS_SOURCE_FILES.map(entry => sourceEntry(entry, options));
}

export function readSourceFile(key, options = {}) {
  inventory(options);
  return sourceEntry(entryFor(key), options);
}

export function readAllSourceText(options = {}) {
  return readRoleBucketsSources(options).map(entry => entry.text).join('\n');
}

function candidates(options) {
  const entries = readRoleBucketsSources(options);
  if (options.in !== undefined) entryFor(options.in);
  return entries;
}

function onlyOne(matches, description, entries) {
  if (matches.length === 0) {
    throw new Error(`${description} は見つかりません（探した先: ${entries.map(entry => `${label(entry)} ${entry.path}`).join(', ')}; found 0）`);
  }
  if (matches.length > 1) {
    throw new Error(`${description} は ${matches.length} 件あります: ${matches.map(item => `${item.key} (${item.path})`).join(', ')} (found ${matches.length})`);
  }
  return matches[0];
}

export function findMember(name, options = {}) {
  const entries = candidates(options);
  const matches = entries.flatMap(entry => entry.classNode.members
    .filter(node => node.name?.getText(entry.ast) === name)
    .map(node => ({ key: entry.key, className: entry.className, path: entry.path, ast: entry.ast, node, text: node.getText(entry.ast) })));
  const selected = options.in === undefined ? matches : matches.filter(item => item.key === options.in);
  if (selected.length === 0) {
    if (options.in !== undefined && matches.length) {
      const expected = entries.find(entry => entry.key === options.in);
      const locations = [...new Set(matches.map(item => `${item.key} (${item.className})`))].join('、');
      throw new Error(`${name} は ${label(expected)} にありません。${locations} にあります（探したファイル: ${expected.path}）`);
    }
    throw new Error(`${name} はどの class にもありません（探した先: ${entries.map(entry => `${label(entry)} ${entry.path}`).join(', ')}）`);
  }
  if (selected.length > 1) {
    const locations = [...new Set(selected.map(item => `${item.key} (${item.className})`))];
    if (locations.length === 1) {
      throw new Error(`${name} は同じ class ${locations[0]} に ${selected.length} 件あります（${selected[0].path}）`);
    }
    throw new Error(`${name} は複数の class にあります: ${locations.join(', ')}。{ in: '<key>' } で場所を指定してください（${[...new Set(selected.map(item => item.path))].join(', ')}）`);
  }
  return selected[0];
}

export function memberText(name, options = {}) {
  return findMember(name, options).text;
}

export function findTopLevelVariable(name, options = {}) {
  const entries = candidates(options).filter(entry => options.in === undefined || entry.key === options.in);
  const matches = entries
    .flatMap(entry => entry.ast.statements.filter(ts.isVariableStatement)
      .flatMap(statement => statement.declarationList.declarations.filter(declaration => declaration.name.getText(entry.ast) === name)
        .map(declaration => ({ key: entry.key, ast: entry.ast, declaration, path: entry.path }))));
  return onlyOne(matches, `top-level variable ${name}`, entries);
}

export function findTopLevelStatement(predicate, options = {}) {
  const entries = candidates(options).filter(entry => options.in === undefined || entry.key === options.in);
  const matches = entries
    .flatMap(entry => entry.ast.statements.filter(statement => predicate(statement, entry.ast))
      .map(statement => ({ key: entry.key, ast: entry.ast, statement, path: entry.path })));
  return onlyOne(matches, 'top-level statement', entries);
}

function anchored(anchor, options) {
  const entries = candidates(options).filter(entry => options.in === undefined || entry.key === options.in);
  const matches = entries.filter(entry => entry.text.includes(anchor));
  if (matches.length === 0) throw new Error(`start anchor not found: ${anchor}（探した先: ${entries.map(entry => label(entry)).join(', ')}）`);
  if (matches.length > 1) throw new Error(`start anchor found in ${matches.length} files: ${anchor}（${matches.map(entry => entry.path).join(', ')}）`);
  return { entry: matches[0], index: matches[0].text.indexOf(anchor) };
}

// end は start と同じファイルだけで探す。次の pane の先頭を拾って別の本文を返さないため。
export function sliceBetween(startAnchor, endAnchor, options = {}) {
  const { entry, index } = anchored(startAnchor, options);
  const end = entry.text.indexOf(endAnchor, index + startAnchor.length);
  if (end < 0) {
    if (entry.text.includes(endAnchor)) throw new Error(`Anchor order is reversed（アンカーの順序が逆）in ${entry.path}: ${startAnchor} before ${endAnchor}`);
    throw new Error(`End anchor not found in ${entry.path}: ${endAnchor} after ${startAnchor}`);
  }
  return entry.text.slice(index, end);
}

export function sliceFrom(anchor, length, options = {}) {
  const { entry, index } = anchored(anchor, options);
  return entry.text.slice(index, index + length);
}

function compiledEntry(entry, options) {
  const path = join(rootOf(options), 'lib/browser', `${entry.base}.js`);
  let text;
  try { text = readFileSync(path, 'utf8'); }
  catch (error) { throw new Error(`Cannot read compiled role-buckets source ${path}; run npm run build:ext: ${error.message}`, { cause: error }); }
  if (!text) throw new Error(`Empty compiled role-buckets source ${path}; run npm run build:ext`);
  return { key: entry.key, path, text };
}

export function readCompiledSources(options = {}) {
  inventory(options);
  return ROLE_BUCKETS_SOURCE_FILES.map(entry => compiledEntry(entry, options));
}

export function readCompiledSource(key, options = {}) {
  inventory(options);
  return compiledEntry(entryFor(key), options);
}

export function readAllCompiledText(options = {}) {
  return readCompiledSources(options).map(entry => entry.text).join('\n');
}
