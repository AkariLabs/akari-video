import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 読み先リスト。F-49/F-50 が新モジュールを作ったら、ここに 1 行足すだけにする（今日は handler 1 本）。
export const HANDLER_SOURCE_FILES = ['src/browser/akari-preview-open-handler.ts'];

const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let cachedSource;

export function readHandlerSource() {
  if (cachedSource !== undefined) return cachedSource;
  const source = HANDLER_SOURCE_FILES.map(relative => {
    const path = join(extensionRoot, relative);
    try {
      return readFileSync(path, 'utf8');
    } catch (error) {
      throw new Error(`Cannot read handler source ${path}: ${error.message}`, { cause: error });
    }
  }).join('\n');
  if (!source || !source.includes('class AkariPreviewOpenHandler')) {
    throw new Error(`Invalid handler source: ${HANDLER_SOURCE_FILES.join(', ')}`);
  }
  cachedSource = source;
  return cachedSource;
}

export function methodBody(name, { source = readHandlerSource() } = {}) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaration = new RegExp(`^    (?:(?:protected|private|public|async|static)\\s+)*${escaped}\\s*\\(`, 'gm');
  const matches = [...source.matchAll(declaration)];
  if (matches.length !== 1) {
    throw new Error(`Expected one handler method ${name}; found ${matches.length}`);
  }
  const start = matches[0].index;
  const close = /^    }(?=\r?$)/gm;
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
