import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { installSkillAdapters } from '../src/index.mjs';

test('installSkillAdapters: kits の skill を全アダプタへ合成し、重複は純正を優先する', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'akari-project-kit-adapter-test-'));
  const home = await mkdtemp(path.join(tmpdir(), 'akari-home-kit-adapter-test-'));
  try {
    await mkdir(path.join(root, '.claude', 'skills', 'official'), { recursive: true });
    await writeFile(path.join(root, '.claude', 'skills', 'official', 'SKILL.md'), '# official\n');
    const kitSkills = path.join(home, 'kits', 'plugin', 'skills');
    await mkdir(path.join(kitSkills, 'kit-only'), { recursive: true });
    await mkdir(path.join(kitSkills, 'official'), { recursive: true });

    const report = await installSkillAdapters(root, { env: { AKARI_HOME: home } });
    for (const adapter of ['.agents', '.codex', '.cursor', '.opencode', '.devin']) {
      const kitLink = path.join(root, adapter, 'skills', 'kit-only');
      assert.equal(
        path.resolve(path.dirname(kitLink), await readlink(kitLink)),
        path.join(kitSkills, 'kit-only')
      );
      const officialLink = path.join(root, adapter, 'skills', 'official');
      assert.equal(
        path.resolve(path.dirname(officialLink), await readlink(officialLink)),
        path.join(root, '.claude', 'skills', 'official')
      );
    }
    assert.equal(report.warnings.length, 5);
    assert.ok(report.warnings.every((line) => line.includes('純正スキルを優先')));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});
