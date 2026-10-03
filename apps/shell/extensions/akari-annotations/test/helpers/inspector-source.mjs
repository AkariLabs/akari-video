import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const INSPECTOR_SECTION_FILES = ['types.ts', 'shared-helpers.ts', 'transform-fields.ts', 'cut-sections.ts', 'photo-fields.ts', 'motion-sections.ts', 'layer-sections.ts'];

const defaultBrowserDir = fileURLToPath(new URL('../../src/browser/', import.meta.url));

function parseSource(name, source) {
  return ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function sectionBody(name, source) {
  const ast = parseSource(name, source);
  const imports = ast.statements.filter(ts.isImportDeclaration);
  if (imports.some(statement => ast.statements.indexOf(statement) > imports.length - 1)) {
    throw new Error(`${name}: imports must precede section declarations`);
  }
  let body = imports.length ? source.slice(imports.at(-1).end) : source;
  body = body.replace(/^(?:(?:[ \t]*\/\/[^\n]*|[ \t]*)\r?\n)*/u, '');
  return body.replace(/^(\s*)export (?=(?:async )?(?:function|const|let|type|interface)\b)/gmu, '$1');
}

export function readInspectorSource({ browserDir = defaultBrowserDir, sectionFiles = INSPECTOR_SECTION_FILES } = {}) {
  const widget = readFileSync(join(browserDir, 'akari-inspector-widget.ts'), 'utf8');
  const sectionDir = join(browserDir, 'inspector/sections');
  let entries;
  try {
    entries = readdirSync(sectionDir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    entries = [];
  }
  const actual = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
    .map(entry => entry.name).sort();
  const expected = [...sectionFiles].sort();
  if (new Set(expected).size !== expected.length || actual.join('\0') !== expected.join('\0')) {
    throw new Error(`inspector sections mismatch: expected ${expected.join(', ')}, found ${actual.join(', ')}`);
  }
  const ast = parseSource('akari-inspector-widget.ts', widget);
  const classes = ast.statements.filter(statement => ts.isClassDeclaration(statement)
    && statement.name?.text === 'AkariInspectorWidget');
  if (classes.length !== 1) throw new Error(`expected one AkariInspectorWidget class, found ${classes.length}`);
  const imports = ast.statements.filter(ts.isImportDeclaration);
  if (!imports.length) throw new Error('akari-inspector-widget.ts: no top-level import');
  if (!sectionFiles.length) return widget;
  const sections = sectionFiles.map(name =>
    sectionBody(name, readFileSync(join(sectionDir, name), 'utf8'))).join('\n\n');
  const position = imports.at(-1).end;
  return `${widget.slice(0, position)}\n\n${sections}\n${widget.slice(position)}`;
}

export function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) throw new Error(`start anchor not found: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex < 0) {
    if (source.indexOf(end) >= 0) throw new Error(`anchor order is reversed: ${start} before ${end}`);
    throw new Error(`end anchor not found: ${end}`);
  }
  return source.slice(startIndex, endIndex);
}

export function readInspectorStyleSource({ browserDir = defaultBrowserDir } = {}) {
  return readFileSync(join(browserDir, 'style/inspector-widget-style.ts'), 'utf8');
}

export function readInspectorSourceWithStyle(options) {
  return `${readInspectorSource(options)}\n${readInspectorStyleSource(options)}`;
}
