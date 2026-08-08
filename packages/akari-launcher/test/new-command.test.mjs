import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runNewCommand } from '../src/new-command.mjs';

function collectLogs() {
  const lines = [];
  const errors = [];
  return { log: (line) => lines.push(line), logError: (line) => errors.push(line), lines, errors };
}

test('akari new --help: 自己記述の使い方を表示して exit 0', async () => {
  const output = collectLogs();
  const result = await runNewCommand(['--help'], output);
  assert.equal(result.exitCode, 0);
  assert.match(output.lines.join('\n'), /akari new <target-dir>/);
});

test('akari new: 不明なオプションは exit 1', async () => {
  const output = collectLogs();
  const result = await runNewCommand(['project', '--unknown'], output);
  assert.equal(result.exitCode, 1);
  assert.match(output.errors.join('\n'), /不明なオプション/);
});

test('akari new: assets の雛形・skills・schemas と注入した scaffold を使う', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-new-command-test-'));
  try {
    const templateDir = join(scratch, 'template');
    const skillsSourceDir = join(scratch, 'skills');
    const schemasSourceDir = join(scratch, 'schemas');
    await mkdir(templateDir, { recursive: true });
    await mkdir(join(skillsSourceDir, 'analyze-footage'), { recursive: true });
    await mkdir(schemasSourceDir, { recursive: true });
    await writeFile(join(skillsSourceDir, 'analyze-footage', 'SKILL.md'), '', 'utf8');
    await writeFile(join(schemasSourceDir, 'analysis.schema.json'), '{}', 'utf8');

    let received;
    const createProject = async (...args) => {
      received = args;
      return {
        destination: args[0],
        copy: { copiedFiles: [], skippedSymlinks: [] },
        fallback: { writtenFiles: [] },
        git: { action: 'skip' },
        reportPath: join(args[0], 'report.html')
      };
    };
    const output = collectLogs();
    const result = await runNewCommand(['project'], {
      ...output,
      cwd: scratch,
      assets: { templateDir, skillsSourceDir, schemasSourceDir, scaffoldModulePath: null },
      createProject
    });

    assert.equal(result.exitCode, 0);
    assert.equal(received[0], join(scratch, 'project'));
    assert.equal(received[1], templateDir);
    assert.deepEqual(received[2], { skillsSourceDir, schemasSourceDir });
    assert.match(output.lines.join('\n'), /プロジェクトを作成しました/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
