import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyCliOnlyWorkspaces } from '../src/self-update.mjs';

for (const shell of [undefined, '0', 'true', '1']) {
  test(`CLI workspaces: AKARI_INSTALL_SHELL=${shell ?? '(unset)'}`, () => {
    const cwd = mkdtempSync(join(tmpdir(), 'akari-cli-workspaces-'));
    const packagePath = join(cwd, 'package.json');
    const original = '{"name":"fixture","private":true,"workspaces":["packages/*","apps/*"],"scripts":{"postinstall":"node setup.mjs"}}\n';
    const previous = process.env.AKARI_INSTALL_SHELL;
    try {
      writeFileSync(packagePath, original);
      if (shell === undefined) delete process.env.AKARI_INSTALL_SHELL;
      else process.env.AKARI_INSTALL_SHELL = shell;

      applyCliOnlyWorkspaces({ cwd });
      const first = readFileSync(packagePath, 'utf8');
      if (shell === '1') {
        assert.equal(first, original, 'opt-in leaves the file untouched');
      } else {
        assert.deepEqual(JSON.parse(first), {
          ...JSON.parse(original), workspaces: ['packages/*']
        });
      }
      applyCliOnlyWorkspaces({ cwd });
      assert.equal(readFileSync(packagePath, 'utf8'), first, 'rewrite is idempotent');
    } finally {
      if (previous === undefined) delete process.env.AKARI_INSTALL_SHELL;
      else process.env.AKARI_INSTALL_SHELL = previous;
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}
