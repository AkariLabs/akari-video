import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);

test('first-use task confirmation is inline, dismissible, and closes when paper changes', async () => {
  const source = await readFile(fileURLToPath(new URL('../src/browser/rough-canvas/rough-canvas-popup.ts', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /window\.(?:confirm|alert)\s*\(/);
  assert.match(source, /this\.confirm\.append\(message, actions\)/);
  assert.match(source, /this\.button\('続ける', 'secondary small'/);
  assert.match(source, /this\.button\('やめる', 'quiet small'/);
  assert.match(source, /this\.memo\.addEventListener\('input', .*this\.closeTaskConfirmation\(\)/);
  assert.match(source, /this\.layer\.onChange\(doc => .*this\.closeTaskConfirmation\(\)/);
});

test('task packet follows backdrop add and clear without Electron', async () => {
  const source = await readFile(fileURLToPath(new URL('../src/browser/rough-canvas/rough-canvas-popup.ts', import.meta.url)), 'utf8');
  const start = source.indexOf('export function taskBackdropPresentation');
  const end = source.indexOf('\nfunction savedBounds', start);
  assert.ok(start >= 0 && end > start);
  const ts = require('typescript');
  const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText;
  const scope = { exports: {} };
  vm.runInNewContext(compiled, scope);
  const presentation = scope.exports.taskBackdropPresentation;
  let preferred = true;
  const backdrop = { image: 'data:image/png;base64,AA' };
  const state = value => JSON.parse(JSON.stringify(presentation(value, preferred)));
  assert.deepEqual(state(undefined), { disabled: true, checked: false, label: '線だけ' });
  assert.deepEqual(state(backdrop), { disabled: false, checked: true, label: '今の画面を含む' });
  assert.deepEqual(state(undefined), { disabled: true, checked: false, label: '線だけ' });
  preferred = false;
  assert.deepEqual(state(backdrop), { disabled: false, checked: false, label: '線だけ' });
  assert.deepEqual(state(undefined), { disabled: true, checked: false, label: '線だけ' });
  assert.deepEqual(state(backdrop), { disabled: false, checked: false, label: '線だけ' });
  assert.match(source, /includeBackdrop\.checked = backdropState\.checked/);
  assert.match(source, /if \(this\.page\.backdrop\) includeBackdropPreferred = includeBackdrop\.checked/);
  assert.match(source, /private clearPaper\(\): void \{[\s\S]*?this\.removeBackdrop\(\)/);
  assert.match(source, /private refreshBackdrop\(\): void \{[\s\S]*?this\.updateTask\?\.\(\)/);
});
