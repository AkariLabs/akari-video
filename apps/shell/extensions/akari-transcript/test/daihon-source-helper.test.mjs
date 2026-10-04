import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DAIHON_SOURCE_FILES, readDaihonSources, readSourceFile, readAllSourceText,
  findMember, memberText, sliceBetween
} from './helpers/daihon-source.mjs';

function fixture(t) {
  const extensionRoot = mkdtempSync(join(tmpdir(), 'daihon-source-'));
  t.after(() => rmSync(extensionRoot, { recursive: true, force: true }));
  mkdirSync(join(extensionRoot, 'src/browser/daihon'), { recursive: true });
  const files = [
    { key: 'a', path: 'daihon/a.ts', className: 'A' },
    { key: 'b', path: 'daihon/b.ts', className: 'B' },
  ];
  const path = key => join(extensionRoot, 'src/browser/daihon', `${key}.ts`);
  const write = (key, text) => writeFileSync(path(key), text);
  write('a', 'class A { first() {} dup() {} }\n');
  write('b', 'class B { onlyInB() {} dup() {} }\n');
  return { extensionRoot, files, path, write };
}

test('real daihon source bytes, fixed order and class declaration', () => {
  const original = new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url);
  const source = readSourceFile('widget');
  const entries = readDaihonSources();
  assert.deepEqual(entries.map(entry => entry.key), ['widget']);
  assert.equal(source.text, readFileSync(original, 'utf8'));
  assert.equal(readAllSourceText(), entries.map(entry => entry.text).join('\n'));
  assert.equal(readAllSourceText(), source.text);
  assert.equal(source.classNode.name.text, 'AkariDaihonWidget');
  assert.equal(source.ast.statements.filter(node => node === source.classNode).length, 1);
  for (const entry of DAIHON_SOURCE_FILES) {
    assert.equal(existsSync(new URL(`../src/browser/${entry.path}`, import.meta.url)), true);
  }
});

test('real member preserves its pinned location, AST and original text', () => {
  const member = findMember('placeTextFromSelection');
  assert.equal(member.key, 'widget');
  assert.equal(member.className, 'AkariDaihonWidget');
  assert.match(member.text, /^protected async placeTextFromSelection/u);
  assert.equal(findMember('placeTextFromSelection', { in: 'widget' }).node, member.node);
  assert.equal(memberText('placeTextFromSelection', { in: 'widget' }), member.text);
  assert.equal(member.node.getText(member.ast), member.text);
  assert.throws(() => findMember('placeTextFromSelection', { in: 'nope' }), /nope/u);
});

test('real focusTarget slice preserves the old exact range', () => {
  const source = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
  const start = '    async focusTarget(';
  const end = '    showError(';
  const method = sliceBetween(start, end);
  assert.equal(method, source.slice(source.indexOf(start), source.indexOf(end)));
  assert.match(method, /focusTarget/u);
  assert.doesNotMatch(method, /showError\(/u);
});

test('synthetic sources reject missing members, missing or duplicate classes, empty or missing files and duplicate keys', t => {
  const f = fixture(t);
  assert.throws(() => findMember('absent', f), /absent/u);
  assert.throws(() => readSourceFile('nope', f), /nope/u);
  f.write('b', 'const value = 1;\n');
  assert.throws(() => readDaihonSources(f), /b\.ts.*B.*found 0/u);
  f.write('b', 'class B {}\nclass B {}\n');
  assert.throws(() => readDaihonSources(f), /b\.ts.*B.*found 2/u);
  f.write('b', '');
  assert.throws(() => readDaihonSources(f), /b\.ts/u);
  unlinkSync(f.path('b'));
  for (const read of [() => readDaihonSources(f), () => readAllSourceText(f),
    () => findMember('first', f), () => sliceBetween('first()', 'dup()', f)]) {
    assert.throws(read, /b\.ts/u);
  }
  f.write('b', 'class B {}\n');
  assert.throws(() => readDaihonSources({ ...f, files: [f.files[0], f.files[0]] }), /a.*daihon\/a\.ts/u);
});

test('synthetic duplicate members, misplaced pin and classless text stay visible', t => {
  const f = fixture(t);
  assert.throws(() => findMember('dup', f), /dup.*2 件/u);
  assert.equal(findMember('dup', { ...f, in: 'a' }).key, 'a');
  assert.equal(findMember('dup', { ...f, in: 'b' }).key, 'b');
  assert.throws(() => findMember('onlyInB', { ...f, in: 'a' }), /onlyInB.*b \(B\)/u);
  f.write('css', 'const CSS = "ONLY_IN_SECOND_FILE";\n');
  const options = { ...f, files: [...f.files, { key: 'css', path: 'daihon/css.ts' }] };
  assert.equal(readSourceFile('css', options).classNode, undefined);
  assert.equal(readAllSourceText(options), readDaihonSources(options).map(entry => entry.text).join('\n'));
  assert.match(readAllSourceText(options), /ONLY_IN_SECOND_FILE/u);
  assert.doesNotMatch(readSourceFile('a', options).text, /ONLY_IN_SECOND_FILE/u);
  assert.throws(() => findMember('CSS', options), /CSS.*どの class にもありません/u);
});

test('synthetic slices stay in one file, locate unique starts and preserve exact bytes', t => {
  const f = fixture(t);
  const source = readFileSync(f.path('a'), 'utf8');
  const start = 'first()';
  const end = 'dup()';
  assert.equal(sliceBetween(start, end, f), source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length)));
  assert.throws(() => sliceBetween('missing start', end, f), /missing start/u);
  assert.throws(() => sliceBetween(start, 'missing end', f), /missing end/u);
  assert.throws(() => sliceBetween(end, start, { ...f, in: 'a' }), /順序が逆/u);
  f.write('b', 'class B { first() {} }\n');
  assert.throws(() => sliceBetween(start, end, f), /start anchor found in 2 files.*first\(\)/u);
  assert.equal(sliceBetween(start, end, { ...f, in: 'a' }), source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length)));
  f.write('a', 'class A { last() {} }\n// START\n');
  f.write('b', '// END\nclass B {}\n');
  assert.throws(() => sliceBetween('START', 'END', f), /end anchor not found.*a\.ts/u);
});

test('synthetic source cache reuses unchanged entries and refreshes changed text without crossing roots', t => {
  const a = fixture(t);
  const b = fixture(t);
  const first = readSourceFile('a', a);
  assert.equal(readSourceFile('a', a), first);
  assert.equal(findMember('first', { ...a, in: 'a' }).ast, first.ast);
  assert.notEqual(readSourceFile('a', b), first);
  a.write('a', 'class A { changed() {} }\n');
  const updated = readSourceFile('a', a);
  assert.notEqual(updated, first);
  assert.equal(updated, readSourceFile('a', a));
  assert.equal(findMember('changed', { ...a, in: 'a' }).ast, updated.ast);
  assert.equal(findMember('first', { ...b, in: 'a' }).key, 'a');
  assert.throws(() => findMember('first', { ...a, in: 'a' }), /first/u);
});
