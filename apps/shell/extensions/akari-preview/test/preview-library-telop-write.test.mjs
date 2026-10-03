import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { resolvePreviewItemWrite } from '../../../../../packages/edit-store/lib/edit-v2-item-write.js';
import { readHandlerSource } from './helpers/handler-source.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readHandlerSource();
const start = source.search(/^    protected async handleOverlayWrite\(/mu);
const end = source.indexOf('\n    }', start);
assert.ok(start >= 0 && end > start);
const code = ts.transpileModule(`class Host { ${source.slice(start, end + 6)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const Host = vm.runInNewContext(`${code}; Host`, {
  resolvePreviewItemWrite, BinaryBuffer: { fromString: value => value }, Error
});
const fixture = readFileSync(new URL('../../../../../packages/render-cut/test/fixtures/object-tree-html-bag/edit.json', import.meta.url), 'utf8');
const uri = value => ({ toString: () => value, resolve: child => uri(`${value}/${child}`) });

test('H はプロジェクトに無いライブラリ参照テロップを専用の説明で拒否する', async () => {
  const host = new Host();
  const writes = [], responses = [];
  host.readText = async () => fixture;
  host.recentWrites = new Map();
  host.fileService = { exists: async () => false, writeFile: async (...args) => writes.push(args) };
  const editUri = { ...uri('file:///fixture/edit.json'), parent: uri('file:///fixture') };
  const widget = { akariPreviewEditUri: editUri, sendMessage: message => responses.push(message) };
  await host.handleOverlayWrite(widget, { type: 'akari-preview-overlay-write', requestId: 'test',
    overlayId: 'plain', patch: { html: '<div>変更後</div>' } });
  assert.equal(responses[0].ok, false);
  assert.equal(responses[0].error, 'このテロップは文字を直接変えられません（ライブラリの素材のため）');
  assert.equal(writes.length, 0);
});
