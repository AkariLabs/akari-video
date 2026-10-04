import { readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// widget から CSS・定数・class メンバが移ったら、移動先をここに登録する。
// className があるエントリだけ AST 探索の対象になる。
export const WIDGET_SOURCE_FILES = [
  { key: 'widget', path: 'akari-annotations-widget.ts', className: 'AkariAnnotationsWidget', compiled: true },
  { key: 'style', path: 'style/annotations-widget-style.ts', compiled: true },
  { key: 'chipCss', path: 'style/generation-chip.css' },
  { key: 'fragmentCss', path: 'style/caption-fragment-blocks.css' },
  { key: 'metrics', path: 'timeline/timeline-metrics.ts', compiled: true },
];

const defaultRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const caches = new Map();
let typescript;

function ts() {
  return typescript ??= require('typescript');
}

function sourceCache(options) {
  const extensionRoot = options.extensionRoot ?? defaultRoot;
  const files = options.files ?? WIDGET_SOURCE_FILES;
  let byFiles = caches.get(extensionRoot);
  if (!byFiles) {
    byFiles = new WeakMap();
    caches.set(extensionRoot, byFiles);
  }
  let cache = byFiles.get(files);
  if (!cache) {
    cache = new Map();
    byFiles.set(files, cache);
  }
  return { extensionRoot, files, cache };
}

function sourceEntry(entry, extensionRoot, cache) {
  const path = join(extensionRoot, 'src/browser', entry.path);
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    throw new Error(`登録済みソース ${entry.key} (${path}) がありません: ${error.message}`, { cause: error });
  }
  const previous = cache.get(entry.key);
  if (previous?.path === path && previous.className === entry.className
    && previous.stamp === stat.mtimeMs && previous.size === stat.size) return previous.value;

  const text = readFileSync(path, 'utf8');
  if (!text) throw new Error(`空のソース ${entry.key} (${path})`);
  if (entry.className) {
    const escaped = entry.className.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const declarations = text.match(new RegExp(`^(?:export )?(?:abstract )?class ${escaped}\\b`, 'gmu')) ?? [];
    if (declarations.length !== 1) {
      throw new Error(`${entry.className} class は ${path} に 1 件必要です（found ${declarations.length}）`);
    }
  }

  let ast;
  let classNode;
  const value = { key: entry.key, path, className: entry.className, text,
    get ast() {
      if (!entry.className) return undefined;
      if (!ast) {
        const typescript = ts();
        const parsed = typescript.createSourceFile(basename(path), text, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.TS);
        const classes = parsed.statements.filter(node => typescript.isClassDeclaration(node) && node.name?.text === entry.className);
        if (classes.length !== 1) throw new Error(`${entry.className} class は ${path} の AST に 1 件必要です（found ${classes.length}）`);
        ast = parsed;
        classNode = classes[0];
      }
      return ast;
    },
    get classNode() {
      if (!entry.className) return undefined;
      void value.ast;
      return classNode;
    } };
  cache.set(entry.key, { path, className: entry.className, stamp: stat.mtimeMs, size: stat.size, value });
  return value;
}

export function readWidgetSources(options = {}) {
  const { extensionRoot, files, cache } = sourceCache(options);
  const keys = new Set();
  return files.map(entry => {
    if (keys.has(entry.key)) throw new Error(`重複した widget source key: ${entry.key} (${entry.path})`);
    keys.add(entry.key);
    return sourceEntry(entry, extensionRoot, cache);
  });
}

export function readSourceFile(key, options = {}) {
  const entries = readWidgetSources(options);
  const entry = entries.find(item => item.key === key);
  if (!entry) throw new Error(`未登録の widget source key: ${key}`);
  return entry;
}

export function readAllSourceText(options = {}) {
  return readWidgetSources(options).map(entry => entry.text).join('\n');
}

function classEntries(options) {
  const entries = readWidgetSources(options);
  if (options.in !== undefined && !entries.some(entry => entry.key === options.in)) {
    throw new Error(`未登録の widget source key: ${options.in}`);
  }
  return entries.filter(entry => entry.className);
}

function unique(matches, name, options, entries) {
  const selected = options.in === undefined ? matches : matches.filter(item => item.key === options.in);
  if (selected.length === 1) return selected[0];
  const place = options.in === undefined ? '登録済み class' : options.in;
  if (selected.length === 0) {
    const elsewhere = matches.map(item => `${item.key} (${item.className})`).join('、');
    throw new Error(`${name} は ${place} にありません。${elsewhere ? `${elsewhere} にあります` : `探した先: ${entries.map(entry => `${entry.key} (${entry.path})`).join('、')}`}`);
  }
  throw new Error(`${name} は ${selected.length} 件あります: ${selected.map(item => `${item.key} (${item.className ?? item.path})`).join('、')}`);
}

export function findMember(name, options = {}) {
  const entries = classEntries(options);
  const matches = entries.flatMap(entry => entry.classNode.members
    .filter(node => node.name?.getText(entry.ast) === name)
    .map(node => ({ key: entry.key, className: entry.className, path: entry.path, ast: entry.ast, node, text: node.getText(entry.ast) })));
  return unique(matches, name, options, entries);
}

export function memberText(name, options = {}) {
  return findMember(name, options).text;
}

export function findTopLevelFunction(name, options = {}) {
  const entries = classEntries(options);
  const matches = entries.flatMap(entry => entry.ast.statements
    .filter(node => ts().isFunctionDeclaration(node) && node.name?.text === name)
    .map(node => ({ key: entry.key, className: entry.className, ast: entry.ast, node })));
  const { key, ast, node } = unique(matches, name, options, entries);
  return { key, ast, node };
}

export function findTopLevelVariable(name, options = {}) {
  const entries = classEntries(options);
  const matches = entries.flatMap(entry => entry.ast.statements.filter(ts().isVariableStatement)
    .flatMap(statement => statement.declarationList.declarations
      .filter(declaration => declaration.name.getText(entry.ast) === name)
      .map(declaration => ({ key: entry.key, className: entry.className, ast: entry.ast, statement, declaration }))));
  const { key, ast, statement, declaration } = unique(matches, name, options, entries);
  return { key, ast, statement, declaration };
}

export function readCompiledSource(key, options = {}) {
  const entries = readWidgetSources(options);
  const entry = entries.find(item => item.key === key);
  if (!entry) throw new Error(`未登録の widget source key: ${key}`);
  const definition = (options.files ?? WIDGET_SOURCE_FILES).find(item => item.key === key);
  if (!definition.compiled || !definition.path.endsWith('.ts')) {
    throw new Error(`${key} (${definition.path}) は compiled source ではありません`);
  }
  const path = join(options.extensionRoot ?? defaultRoot, 'lib/browser', definition.path.replace(/\.ts$/u, '.js'));
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`${key} の compiled source ${path} がありません。npm run build:ext を実行してください: ${error.message}`, { cause: error });
  }
  if (!text) throw new Error(`${key} の compiled source ${path} は空です。npm run build:ext を実行してください`);
  return { key, path, text };
}
