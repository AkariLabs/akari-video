import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import {
  INSPECTOR_SECTION_FILES, readInspectorSource, readInspectorSourceWithStyle, sliceBetween
} from './helpers/inspector-source.mjs';

test('inspector source has one class and no duplicate top-level function or const', () => {
  const source = readInspectorSource();
  const ast = ts.createSourceFile('inspector.ts', source, ts.ScriptTarget.Latest, true);
  assert.equal(ast.statements.filter(node => ts.isClassDeclaration(node)
    && node.name?.text === 'AkariInspectorWidget').length, 1);
  const names = ast.statements.flatMap(node => ts.isFunctionDeclaration(node) && node.name
    ? [node.name.text]
    : ts.isVariableStatement(node) && (node.declarationList.flags & ts.NodeFlags.Const)
      ? node.declarationList.declarations.filter(declaration => ts.isIdentifier(declaration.name))
        .map(declaration => declaration.name.text)
      : []);
  assert.equal(new Set(names).size, names.length);
});

test('section inventory, normalization and insertion follow original order', () => {
  const browserDir = mkdtempSync(join(tmpdir(), 'inspector-source-'));
  try {
    mkdirSync(join(browserDir, 'inspector/sections'), { recursive: true });
    mkdirSync(join(browserDir, 'style'));
    writeFileSync(join(browserDir, 'akari-inspector-widget.ts'),
      "import { a } from './a';\nimport { b } from './b';\n\nclass AkariInspectorWidget {}\n");
    writeFileSync(join(browserDir, 'inspector/sections/types.ts'),
      "// header\nimport { x } from './x';\n// section header\nexport const sectionValue = 1;\n");
    writeFileSync(join(browserDir, 'style/inspector-widget-style.ts'), '.akari-inspector-widget {}\n');
    assert.throws(() => readInspectorSource({ browserDir }), /sections mismatch/u);
    const source = readInspectorSource({ browserDir, sectionFiles: ['types.ts'] });
    assert.ok(source.indexOf("import { b }") < source.indexOf('const sectionValue'));
    assert.ok(source.indexOf('const sectionValue') < source.indexOf('class AkariInspectorWidget'));
    assert.doesNotMatch(source, /export const sectionValue|import \{ x \}|section header|\/\/ header/u);
    assert.match(readInspectorSourceWithStyle({ browserDir, sectionFiles: ['types.ts'] }),
      /\.akari-inspector-widget/u);
    writeFileSync(join(browserDir, 'inspector/sections/extra.ts'), 'export const extra = 2;\n');
    assert.throws(() => readInspectorSource({ browserDir, sectionFiles: ['types.ts'] }), /sections mismatch/u);
    assert.throws(() => readInspectorSource({ browserDir, sectionFiles: ['types.ts', 'missing.ts'] }), /sections mismatch/u);
  } finally {
    rmSync(browserDir, { recursive: true, force: true });
  }
  assert.deepEqual(INSPECTOR_SECTION_FILES, ['types.ts', 'shared-helpers.ts', 'transform-fields.ts', 'cut-sections.ts', 'photo-fields.ts', 'motion-sections.ts', 'layer-sections.ts', 'caption-sections.ts', 'audio-sections.ts', 'overlay-sections.ts', 'animator-section.ts', 'tree-item-sections.ts', 'adjust-sections.ts']);
});

test('sliceBetween reports missing and reversed anchors', () => {
  assert.equal(sliceBetween('a middle b', 'a', 'b'), 'a middle ');
  assert.throws(() => sliceBetween('a middle b', 'missing', 'b'), /start anchor not found/u);
  assert.throws(() => sliceBetween('a middle b', 'a', 'missing'), /end anchor not found/u);
  assert.throws(() => sliceBetween('b middle a', 'a', 'b'), /order is reversed/u);
});

test('real source with style contains the inspector CSS rule', () => {
  assert.match(readInspectorSourceWithStyle(), /\.akari-inspector-widget/u);
});
