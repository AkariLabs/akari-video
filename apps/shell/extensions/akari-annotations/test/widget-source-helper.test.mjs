import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Module from 'node:module';
import {
  WIDGET_SOURCE_FILES, readWidgetSources, readSourceFile, readAllSourceText,
  findMember, memberText, findTopLevelFunction, findTopLevelVariable, readCompiledSource
} from './helpers/widget-source.mjs';

function fixture(t) {
  const extensionRoot = mkdtempSync(join(tmpdir(), 'widget-source-'));
  t.after(() => rmSync(extensionRoot, { recursive: true, force: true }));
  const files = [
    { key: 'widget', path: 'widget.ts', className: 'Widget', compiled: true },
    { key: 'b', path: 'extra.ts', className: 'WidgetExtra', compiled: true },
    { key: 'css', path: 'style/chip.css' }
  ];
  const sourcePath = key => join(extensionRoot, 'src/browser', files.find(entry => entry.key === key).path);
  const compiledPath = key => join(extensionRoot, 'lib/browser', files.find(entry => entry.key === key).path.replace(/\.ts$/u, '.js'));
  const write = (key, text) => writeFileSync(sourcePath(key), text);
  mkdirSync(join(extensionRoot, 'src/browser/style'), { recursive: true });
  mkdirSync(join(extensionRoot, 'lib/browser'), { recursive: true });
  write('widget', 'export class Widget { alpha() {} dup() {} }\nfunction helper() {}\nconst VALUE = 1;\n');
  write('b', 'class WidgetExtra { onlyInB() {} dup() {} }\n');
  write('css', '.fixture-chip { color: red; }\n');
  writeFileSync(compiledPath('widget'), 'class Widget {}\n');
  writeFileSync(compiledPath('b'), 'class WidgetExtra {}\n');
  return { extensionRoot, files, sourcePath, compiledPath, write,
    fresh: () => ({ extensionRoot, files: [...files] }) };
}

test('TypeScript は AST getter を読むときだけ解決する', () => {
  const helperText = readFileSync(new URL('./helpers/widget-source.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(helperText, /from ['"]typescript['"]|import\s+ts\s+from/u);
  const originalLoad = Module._load;
  let loads = 0;
  Module._load = function (request, ...args) {
    if (request === 'typescript') loads++;
    return originalLoad.call(this, request, ...args);
  };
  try {
    assert.ok(readSourceFile('widget').text.length > 0);
    assert.ok(readAllSourceText().length > 0);
    assert.equal(loads, 0);
    assert.ok(readSourceFile('widget').ast);
    assert.equal(loads, 1);
    assert.equal(readSourceFile('widget').ast, readSourceFile('widget').ast);
    assert.equal(loads, 1);
  } finally {
    Module._load = originalLoad;
  }
});

test('実物の 5 ファイルは元のバイト列と固定順で一致する', () => {
  const paths = {
    widget: '../src/browser/akari-annotations-widget.ts',
    style: '../src/browser/style/annotations-widget-style.ts',
    chipCss: '../src/browser/style/generation-chip.css',
    fragmentCss: '../src/browser/style/caption-fragment-blocks.css',
    metrics: '../src/browser/timeline/timeline-metrics.ts'
  };
  const entries = readWidgetSources();
  assert.deepEqual(entries.map(entry => entry.key), ['widget', 'style', 'chipCss', 'fragmentCss', 'metrics']);
  for (const file of WIDGET_SOURCE_FILES) {
    assert.ok(existsSync(new URL(`../src/browser/${file.path}`, import.meta.url)), file.path);
  }
  for (const entry of entries) {
    const original = new URL(paths[entry.key], import.meta.url);
    assert.ok(existsSync(original));
    assert.equal(readSourceFile(entry.key).text, readFileSync(original, 'utf8'));
    assert.ok(WIDGET_SOURCE_FILES.some(file => file.key === entry.key && file.path));
  }
  const all = readAllSourceText();
  assert.equal(all, entries.map(entry => entry.text).join('\n'));
  assert.ok(all.length > entries[0].text.length);
  assert.ok(all.startsWith(entries[0].text));
  assert.equal(entries[0].classNode.name.text, 'AkariAnnotationsWidget');
  assert.equal(entries[1].classNode, undefined);
  assert.match(all, /ANNOTATIONS_WIDGET_CSS/u);
  assert.match(all, /export const EDGE_ZONE_PX/u);
  assert.match(all, /\.akari-generation-chip-layout/u);
});

test('実物のメンバ・top-level 宣言と pin を探せる', () => {
  const member = findMember('handleMaterialDragOver');
  assert.equal(member.key, 'widget');
  assert.equal(member.className, 'AkariAnnotationsWidget');
  assert.match(member.text, /^protected handleMaterialDragOver/u);
  assert.equal(member.text, memberText('handleMaterialDragOver', { in: 'widget' }));
  assert.equal(findMember('applyLibraryItem', { in: 'widget' }).key, 'widget');
  assert.throws(() => findMember('selectedSourceT'), /selectedSourceT.*2 件/u);
  assert.throws(() => findMember('handleMaterialDragOver', { in: 'nope' }), /nope/u);
  assert.equal(findTopLevelFunction('parseMaterialDragPayload').key, 'widget');
  const variable = findTopLevelVariable('TIMELINE_ADJUST_BYPASS_EVENT');
  assert.equal(variable.key, 'widget');
  assert.ok(variable.statement.declarationList.declarations.includes(variable.declaration));
  assert.throws(() => findTopLevelFunction('noSuchFn'), /noSuchFn/u);
});

test('実物の compiled source は一致し、CSS は拒否する', () => {
  const compiled = new URL('../lib/browser/akari-annotations-widget.js', import.meta.url);
  if (existsSync(compiled)) {
    assert.equal(readCompiledSource('widget').text, readFileSync(compiled, 'utf8'));
  } else {
    assert.throws(() => readCompiledSource('widget'), /akari-annotations-widget\.js.*build:ext/u);
  }
  assert.throws(() => readCompiledSource('chipCss'), /chipCss.*generation-chip\.css/u);
});

test('合成ファイルの重複・pin・class の無いテキストを検査する', t => {
  const f = fixture(t);
  assert.throws(() => findMember('missing', f), /missing/u);
  assert.throws(() => findMember('dup', f), /dup.*2 件/u);
  assert.equal(findMember('dup', { ...f, in: 'widget' }).key, 'widget');
  assert.equal(findMember('dup', { ...f, in: 'b' }).key, 'b');
  assert.throws(() => findMember('onlyInB', { ...f, in: 'widget' }), /onlyInB は widget にありません。b \(WidgetExtra\) にあります/u);
  assert.equal(readSourceFile('css', f).classNode, undefined);
  assert.equal(readSourceFile('css', f).ast, undefined);
  assert.match(readAllSourceText(f), /\.fixture-chip/u);
  assert.throws(() => findMember('fixture-chip', f), /fixture-chip/u);
  assert.equal(findTopLevelFunction('helper', f).key, 'widget');
  assert.equal(findTopLevelVariable('VALUE', f).key, 'widget');
  assert.throws(() => findTopLevelVariable('missing', f), /missing/u);
});

test('合成ファイルの欠落・空・class 数・key 重複を全入口で拒否する', t => {
  const f = fixture(t);
  const reads = options => [
    () => readWidgetSources(options), () => readSourceFile('widget', options),
    () => readAllSourceText(options), () => findMember('alpha', options),
    () => findTopLevelFunction('helper', options), () => findTopLevelVariable('VALUE', options),
    () => readCompiledSource('widget', options)
  ];
  f.write('widget', 'const noClass = true;\n');
  for (const read of reads(f.fresh())) assert.throws(read, /Widget.*widget\.ts/u);
  f.write('widget', 'class Widget {}\nclass Widget {}\n');
  for (const read of reads(f.fresh())) assert.throws(read, /Widget.*found 2/u);
  f.write('widget', '  class Widget {}\n');
  for (const read of reads(f.fresh())) assert.throws(read, /Widget.*found 0/u);
  f.write('widget', '');
  for (const read of reads(f.fresh())) assert.throws(read, /widget\.ts/u);
  f.write('widget', 'class Widget { alpha() {} }\nfunction helper() {}\nconst VALUE = 1;\n');
  unlinkSync(f.sourcePath('b'));
  for (const read of reads(f.fresh())) assert.throws(read, /extra\.ts/u);
  f.write('b', 'class WidgetExtra {}\n');
  const duplicate = { extensionRoot: f.extensionRoot, files: [...f.files, { ...f.files[0] }] };
  for (const read of reads(duplicate)) assert.throws(read, /widget.*key/u);
  const wrongClass = { extensionRoot: f.extensionRoot, files: f.files.map(entry => entry.key === 'widget'
    ? { ...entry, className: 'MissingWidget' } : entry) };
  for (const read of reads(wrongClass)) assert.throws(read, /MissingWidget.*widget\.ts/u);
});

test('合成 compiled の欠落・空と未登録の key を拒否する', t => {
  const f = fixture(t);
  assert.equal(readCompiledSource('widget', f).text, readFileSync(f.compiledPath('widget'), 'utf8'));
  assert.throws(() => readCompiledSource('css', f), /css.*chip\.css/u);
  assert.throws(() => readSourceFile('nope', f), /nope/u);
  assert.throws(() => readCompiledSource('nope', f), /nope/u);
  unlinkSync(f.compiledPath('widget'));
  assert.throws(() => readCompiledSource('widget', f), /widget\.js.*build:ext/u);
  writeFileSync(f.compiledPath('widget'), '');
  assert.throws(() => readCompiledSource('widget', f), /widget\.js.*build:ext/u);
});

test('同じ root と files のオブジェクトを再利用し、別 root を分離する', t => {
  const first = fixture(t);
  const second = fixture(t);
  const original = readSourceFile('widget', first);
  assert.equal(original, readSourceFile('widget', first));
  assert.equal(original.ast, readSourceFile('widget', first).ast);
  assert.notEqual(original, readSourceFile('widget', second));
  second.write('widget', 'class Widget { changed() {} }\n');
  assert.equal(findMember('changed', second).key, 'widget');
  assert.equal(findMember('alpha', first).key, 'widget');
});
