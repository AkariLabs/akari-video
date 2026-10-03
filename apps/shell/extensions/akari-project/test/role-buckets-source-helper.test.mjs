import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ROLE_BUCKETS_SOURCE_FILES, readRoleBucketsSources, readSourceFile, readAllSourceText,
  findMember, memberText, findTopLevelVariable, findTopLevelStatement,
  sliceBetween, sliceFrom, readCompiledSources, readCompiledSource, readAllCompiledText
} from './helpers/role-buckets-source.mjs';

function fixture(t) {
  const extensionRoot = mkdtempSync(join(tmpdir(), 'role-buckets-source-'));
  t.after(() => rmSync(extensionRoot, { recursive: true, force: true }));
  mkdirSync(join(extensionRoot, 'src/browser'), { recursive: true });
  mkdirSync(join(extensionRoot, 'lib/browser'), { recursive: true });
  const texts = {
    widget: 'export class AkariRoleBucketsWidget { alpha() {} loadMaterials() {} }\nconst PROJECT_DATA_FILES = [1];\n',
    outputs: 'export class AkariOutputsPane { renderOutputCard() {} }\n',
    materials: 'export class AkariMaterialsPane { loadMaterials() {} renderMaterialCard() {} }\n',
    library: 'export class AkariLibraryPane { end() {} }\n'
  };
  const sourcePath = key => join(extensionRoot, 'src/browser', `${ROLE_BUCKETS_SOURCE_FILES.find(entry => entry.key === key).base}.tsx`);
  const compiledPath = key => join(extensionRoot, 'lib/browser', `${ROLE_BUCKETS_SOURCE_FILES.find(entry => entry.key === key).base}.js`);
  for (const entry of ROLE_BUCKETS_SOURCE_FILES) {
    writeFileSync(sourcePath(entry.key), texts[entry.key]);
    writeFileSync(compiledPath(entry.key), `// ${entry.key}\n`);
  }
  return { extensionRoot, sourcePath, compiledPath, write: (key, text) => writeFileSync(sourcePath(key), text) };
}

test('real source bytes, fixed order, classes and pane coverage', () => {
  const entries = readRoleBucketsSources();
  assert.deepEqual(entries.map(entry => entry.key), ['widget', 'outputs', 'materials', 'library']);
  const originalPaths = {
    widget: new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url),
    outputs: new URL('../src/browser/akari-outputs-pane.tsx', import.meta.url),
    materials: new URL('../src/browser/akari-materials-pane.tsx', import.meta.url),
    library: new URL('../src/browser/akari-library-pane.tsx', import.meta.url)
  };
  for (const entry of entries) {
    assert.equal(readSourceFile(entry.key).text, readFileSync(originalPaths[entry.key], 'utf8'));
    assert.equal(entry.classNode.name.text, entry.className);
    assert.equal(entry.ast.statements.filter(node => node === entry.classNode).length, 1);
  }
  assert.equal(readAllSourceText(), entries.map(entry => entry.text).join('\n'));
  assert.match(readAllSourceText(), /class AkariOutputsPane/u);
  assert.match(readAllSourceText(), /class AkariMaterialsPane/u);
  assert.match(readAllSourceText(), /class AkariLibraryPane/u);
});

test('real members expose location, original text and pinned errors', () => {
  const output = findMember('renderOutputCard');
  assert.equal(output.key, 'outputs');
  assert.equal(output.className, 'AkariOutputsPane');
  assert.match(output.text, /^(?:protected |private |public )?renderOutputCard\(/u);
  const material = findMember('renderMaterialCard', { in: 'materials' });
  assert.equal(material.key, 'materials');
  assert.match(memberText('renderMaterialCard', { in: 'materials' }), /renderMaterialCard\(/u);
  assert.throws(() => findMember('loadMaterials'), /loadMaterials.*widget \(AkariRoleBucketsWidget\).*materials \(AkariMaterialsPane\)/u);
  assert.equal(findMember('loadMaterials', { in: 'materials' }).key, 'materials');
  assert.throws(() => findMember('renderOutputCard', { in: 'widget' }), /renderOutputCard.*outputs \(AkariOutputsPane\)/u);
  assert.equal(readSourceFile('widget').ast, findMember('init', { in: 'widget' }).ast);
});

test('synthetic files reject missing members, classes, empty text and inventory drift', t => {
  const f = fixture(t);
  assert.throws(() => readSourceFile('nope', f), /nope/u);
  assert.throws(() => findMember('alpha', { ...f, in: 'nope' }), /nope/u);
  assert.throws(() => readCompiledSource('nope', f), /nope/u);
  assert.throws(() => findMember('absent', f), /absent/u);
  f.write('outputs', 'const noClass = true;\n');
  assert.throws(() => readRoleBucketsSources(f), /AkariOutputsPane.*akari-outputs-pane\.tsx/u);
  f.write('outputs', 'class AkariOutputsPane {}\nclass AkariOutputsPane {}\n');
  assert.throws(() => readRoleBucketsSources(f), /AkariOutputsPane.*found 2/u);
  f.write('outputs', '');
  assert.throws(() => readRoleBucketsSources(f), /akari-outputs-pane\.tsx/u);
  f.write('outputs', 'class AkariOutputsPane {}\n');
  writeFileSync(join(f.extensionRoot, 'src/browser/akari-foo-pane.tsx'), 'export class AkariFooPane {}\n');
  for (const read of [() => readRoleBucketsSources(f), () => findMember('alpha', f),
    () => readAllSourceText(f), () => readCompiledSources(f)]) {
    assert.throws(read, /akari-foo-pane\.tsx/u);
  }
  unlinkSync(join(f.extensionRoot, 'src/browser/akari-foo-pane.tsx'));
  unlinkSync(f.sourcePath('outputs'));
  for (const read of [() => readRoleBucketsSources(f), () => findMember('alpha', f),
    () => readAllSourceText(f), () => readCompiledSources(f), () => sliceBetween('alpha()', 'loadMaterials()', f)]) {
    assert.throws(read, /akari-outputs-pane\.tsx/u);
  }
});

test('synthetic slices stay within one file and preserve exact bytes', t => {
  const f = fixture(t);
  const text = readFileSync(f.sourcePath('widget'), 'utf8');
  const start = 'alpha()';
  const end = 'loadMaterials()';
  assert.equal(sliceBetween(start, end, f), text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start) + start.length)));
  assert.equal(sliceFrom(start, 12, f), text.slice(text.indexOf(start), text.indexOf(start) + 12));
  assert.throws(() => sliceBetween('missing start', end, f), /missing start/u);
  assert.throws(() => sliceBetween(start, 'missing end', f), /missing end/u);
  assert.throws(() => sliceBetween(end, start, { ...f, in: 'widget' }), /order is reversed/u);
  assert.throws(() => sliceFrom('missing anchor', 10, f), /missing anchor/u);
  f.write('outputs', 'class AkariOutputsPane { alpha() {} }\n');
  assert.throws(() => sliceBetween(start, end, f), /start anchor found in 2 files: alpha\(\)/u);
  assert.equal(sliceBetween(start, end, { ...f, in: 'widget' }), text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start) + start.length)));
  f.write('outputs', 'class AkariOutputsPane {}\n');
  f.write('materials', 'class AkariMaterialsPane {}\n// START\n');
  f.write('library', '// END\nclass AkariLibraryPane {}\n');
  assert.throws(() => sliceBetween('START', 'END', f), /End anchor not found.*akari-materials-pane\.tsx/u);
});

test('synthetic top-level lookups and compiled reads reject missing or duplicate entries', t => {
  const f = fixture(t);
  assert.equal(findTopLevelVariable('PROJECT_DATA_FILES', f).key, 'widget');
  assert.equal(findTopLevelStatement((node, ast) => node.getText(ast).includes('PROJECT_DATA_FILES'), f).key, 'widget');
  assert.throws(() => findTopLevelStatement(() => false, f), /top-level statement.*found 0/u);
  assert.throws(() => findTopLevelVariable('ABSENT', f), /ABSENT/u);
  f.write('outputs', 'class AkariOutputsPane {}\nconst PROJECT_DATA_FILES = [2];\n');
  assert.throws(() => findTopLevelVariable('PROJECT_DATA_FILES', f), /PROJECT_DATA_FILES.*found 2/u);
  assert.throws(() => findTopLevelStatement((node, ast) => node.getText(ast).includes('PROJECT_DATA_FILES'), f), /top-level statement.*found 2/u);
  assert.equal(findTopLevelVariable('PROJECT_DATA_FILES', { ...f, in: 'widget' }).key, 'widget');
  assert.equal(readCompiledSource('widget', f).text, readFileSync(f.compiledPath('widget'), 'utf8'));
  assert.equal(readAllCompiledText(f), readCompiledSources(f).map(entry => entry.text).join('\n'));
  unlinkSync(f.compiledPath('widget'));
  assert.throws(() => readCompiledSource('widget', f), /akari-role-buckets-widget\.js.*build:ext/u);
  writeFileSync(f.compiledPath('widget'), '');
  assert.throws(() => readCompiledSource('widget', f), /Empty compiled.*akari-role-buckets-widget\.js/u);
});

test('synthetic source cache reuses unchanged AST and refreshes changed text', t => {
  const f = fixture(t);
  const first = readSourceFile('widget', f);
  assert.equal(first.ast, readSourceFile('widget', f).ast);
  assert.equal(first.ast, findMember('alpha', { ...f, in: 'widget' }).ast);
  const changed = 'class AkariRoleBucketsWidget { beta() {} }\n';
  f.write('widget', changed);
  const second = readSourceFile('widget', f);
  assert.equal(second.text, changed);
  assert.notEqual(second.ast, first.ast);
  assert.equal(second.ast, readSourceFile('widget', f).ast);
  assert.equal(second.ast, findMember('beta', { ...f, in: 'widget' }).ast);
  assert.throws(() => findMember('alpha', { ...f, in: 'widget' }), /alpha.*どの class にもありません/u);
});
