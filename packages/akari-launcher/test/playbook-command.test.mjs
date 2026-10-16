import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPlaybookCommand } from '../src/playbook-command.mjs';
import { createProject } from '../../project-scaffold/src/index.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sample = join(repo, 'packages', 'project-scaffold', 'test', 'fixtures', 'playbook-sample');

test('CLI list JSON/category and apply dry-run then apply', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'akari-playbook-cli-'));
  try {
    const home = join(temp, 'home');
    const bookDir = join(home, 'playbooks', 'kaisetsu-vertical-60s');
    await mkdir(bookDir, { recursive: true });
    for (const name of ['playbook.md', 'playbook.json']) {
      await writeFile(join(bookDir, name), await readFile(join(sample, name)));
    }
    const project = join(temp, 'project');
    await createProject(project, join(repo, 'templates', 'project-default'));
    const outputs = [];
    const options = { env: { AKARI_HOME: home }, cwd: temp, log: line => outputs.push(line), error: line => outputs.push(line) };
    assert.equal((await runPlaybookCommand(['list', '--json', '--category', 'explainer'], options)).exitCode, 0);
    const [entry] = JSON.parse(outputs.pop());
    assert.deepEqual([entry.id, entry.source, entry.targetDurationSec], ['kaisetsu-vertical-60s', 'local', 60]);
    assert.equal((await runPlaybookCommand(['list', '--json', '--category', 'cm'], options)).entries.length, 0);
    assert.equal((await runPlaybookCommand(['apply', entry.id, '--into', project, '--dry-run'], options)).exitCode, 0);
    assert.equal((await runPlaybookCommand(['apply', entry.id, '--into', project], options)).exitCode, 0);
    assert.match(await readFile(join(project, '.akari', 'reports', 'playbook-apply.html'), 'utf8'), /作り方の適用/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
