import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('L1 は隔離起動・3 手順・SS 3 枚・sanitize・自 PID cleanup を宣言する', async () => {
  const source = await readFile(new URL('../evidence/caption-split-join/scripts/l1-caption-split-join.mjs', import.meta.url), 'utf8');
  const cdp = await readFile(new URL('../evidence/caption-split-join/scripts/cdp-lib.mjs', import.meta.url), 'utf8');
  assert.match(source, /AKARI_HOME/u);
  assert.match(source, /--user-data-dir=/u);
  assert.match(source, /THEIA_CONFIG_DIR/u);
  assert.match(source, /replaceAll\(REPO, '<WORKTREE>'\)/u);
  assert.match(source, /process\.kill\(pid, 'SIGTERM'\)/u);
  assert.match(source, /settlePreloadOverlay/u);
  assert.match(source, /ensureDaihonVisible/u);
  assert.match(source, /return r!==null&&typeof r==='object'\?'\[object\]'/u);
  assert.match(source, /data-caption-id="c-0002"/u);
  assert.match(source, /button\.akari-daihon-selmerge-next/u);
  assert.match(source, /button: 'right', buttons: 2, clickCount: 1/u);
  assert.match(source, /return \{ route, rows:/u);
  assert.doesNotMatch(cdp, /daihon-word-unit/u);
  assert.match(cdp, /export class CDP/u);
  assert.equal((source.match(/await step\(/gu) ?? []).length, 3);
  assert.equal((source.match(/await shot\(/gu) ?? []).length, 3);
});
