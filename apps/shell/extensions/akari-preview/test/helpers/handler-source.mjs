import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 読み先リスト。後続の分割では対象モジュールをここに追加する。
export const HANDLER_SOURCE_FILES = [
  'src/browser/akari-preview-open-handler.ts',
  'src/browser/preview-script-diagnostics.ts',
  'src/browser/preview-script-frame-engine-watchdog.ts',
  'src/browser/preview-script-frame-engine-bootstrap.ts',
  'src/browser/preview-script-host-adapter.ts',
  'src/browser/preview-script-bootstrap.ts',
];
export const HANDLER_COMPILED_FILES = HANDLER_SOURCE_FILES.map(relative => relative.replace(/^src\//u, 'lib/').replace(/\.ts$/u, '.js'));

const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let cachedSource;
let cachedCompiled;

function readFiles(files, kind, marker) {
  const content = files.map(relative => {
    const path = join(extensionRoot, relative);
    try {
      return readFileSync(path, 'utf8');
    } catch (error) {
      throw new Error(`Cannot read handler ${kind} ${path}: ${error.message}`, { cause: error });
    }
  }).join('\n');
  if (!content || !content.includes(marker)) {
    throw new Error(`Invalid handler ${kind}: ${files.join(', ')}`);
  }
  return content;
}

export function readHandlerSource() {
  if (cachedSource !== undefined) return cachedSource;
  cachedSource = readFiles(HANDLER_SOURCE_FILES, 'source', 'class AkariPreviewOpenHandler');
  return cachedSource;
}

export function readHandlerCompiled() {
  if (cachedCompiled !== undefined) return cachedCompiled;
  cachedCompiled = readFiles(HANDLER_COMPILED_FILES, 'compiled', 'AkariPreviewOpenHandler');
  return cachedCompiled;
}

export function methodBody(name, { source = readHandlerSource() } = {}) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaration = new RegExp(`^(?:    (?:(?:protected|private|public|async|static)\\s+)*|export function )${escaped}\\s*\\(`, 'gm');
  const matches = [...source.matchAll(declaration)];
  if (matches.length !== 1) {
    throw new Error(`Expected one handler method ${name}; found ${matches.length}`);
  }
  const start = matches[0].index;
  const close = matches[0][0].startsWith('export function ') ? /^}(?=\r?$)/gm : /^    }(?=\r?$)/gm;
  close.lastIndex = start + matches[0][0].length;
  const ending = close.exec(source);
  if (!ending) throw new Error(`Cannot find end of handler method ${name}`);
  return source.slice(start, ending.index + ending[0].length);
}

export function sliceBetween(startAnchor, endAnchor, { source = readHandlerSource(), from = 0 } = {}) {
  if (!startAnchor || !endAnchor) throw new Error(`Empty anchor: ${startAnchor} / ${endAnchor}`);
  const start = source.indexOf(startAnchor, from);
  if (start < 0) throw new Error(`Start anchor not found: ${startAnchor}`);
  const end = source.indexOf(endAnchor, start);
  if (end <= start) throw new Error(`End anchor not found after ${startAnchor}: ${endAnchor}`);
  return source.slice(start, end);
}
