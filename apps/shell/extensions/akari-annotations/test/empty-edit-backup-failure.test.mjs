import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

import { applyMigration, planMigration } from '../../../../../packages/edit-store/lib/migrate/index.js';

function widgetMigrationMethod() {
  const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
  const start = source.indexOf('    protected async resolveLegacyEditForOpen(');
  const end = source.indexOf('    protected setLegacyReadOnly(', start);
  assert.ok(start >= 0 && end > start);
  const compiled = ts.transpileModule(`class Widget {\n${source.slice(start, end)}\n}\nexports.Widget = Widget;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInContext(compiled, vm.createContext({ exports }), { filename: 'akari-annotations-widget.ts' });
  return exports.Widget;
}

test('空 edit.json の退避失敗は日本語で通知し、確認ダイアログも初期化も行わない', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-widget-backup-failure-'));
  const editPath = join(root, 'edit.json');
  const text = '{}\n';
  try {
    await writeFile(editPath, text);
    await mkdir(join(root, '.akari'));
    await writeFile(join(root, '.akari', 'backup'), 'directory-blocker');
    const proposal = planMigration(root, editPath, text);
    assert.equal(proposal.emptyProject, true);
    const Widget = widgetMigrationMethod();
    const widget = new Widget();
    const notices = [];
    let readOnly;
    widget.location = {
      editUri: { toString: () => editPath }, root: { toString: () => root },
    };
    widget.annotationsService = {
      planEditMigration: async () => proposal,
      applyEditMigration: applyMigration,
    };
    widget.messages = { info: () => { throw new Error('確認ダイアログを表示しました'); } };
    widget.setLegacyReadOnly = value => { readOnly = value; };
    widget.showNotice = value => { notices.push(value); };

    assert.equal(await widget.resolveLegacyEditForOpen(text), undefined);
    assert.equal(readOnly, true);
    assert.equal(notices.length, 1);
    assert.match(notices[0], /初期化できませんでした（退避に失敗）/u);
    assert.match(notices[0], /元ファイルは変更されていません/u);
    assert.equal(await readFile(editPath, 'utf8'), text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
