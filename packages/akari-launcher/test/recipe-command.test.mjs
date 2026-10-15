import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runRecipeCommand } from '../src/recipe-command.mjs';
import { linkKitRecipes, readKitsLedger, removeKit, writeKitsLedger } from '../src/kits.mjs';
import { cliText } from '../src/i18n.mjs';

const recipe = (id, needs) => ({ version: 0, kind: 'akari-recipe', id, name: id,
  needs, inputs: {}, outputs: [], checkpoint: '', gates: [] });
function put(root, id, value) {
  const dir = path.join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'recipe.json'), JSON.stringify(value));
}

test('recipe shelf precedence, ignored preferences, planning gates and missing capability', async () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'akari-recipe-cli-'));
  try {
    const home = path.join(temp, 'home');
    const project = path.join(temp, 'project');
    put(path.join(home, 'tool-recipes'), 'music', recipe('music', ['music-generation']));
    put(path.join(project, 'recipes'), 'music', recipe('music', ['3d-render']));
    put(path.join(home, 'tool-recipes'), 'image', recipe('image', ['image-generation']));
    put(path.join(home, 'tool-recipes'), 'wrong', { ...recipe('wrong', []), kind: 'preference' });
    put(path.join(home, 'recipes'), 'preference', recipe('preference', ['publish']));
    mkdirSync(path.join(project, '.akari'), { recursive: true });
    writeFileSync(path.join(project, '.akari', 'connections.json'), JSON.stringify({ providers: [
      { id: 'blender', kind: 'genai', provides: ['3d-render'], adapter: { type: 'local' },
        terms: { checked: '2026-10-16' }, doctor: { status: 'ok' }, notes: { billing: 'free' } },
      { id: 'image-api', kind: 'image', adapter: { type: 'official-api' },
        doctor: { status: 'ok' }, notes: { billing: 'paid per image' } },
      { id: 'speech-unauthorized', kind: 'tts', doctor: { status: 'unauthorized' } },
      { id: 'speech-unconfigured', kind: 'tts', doctor: { status: 'unconfigured' } },
      { id: 'speech-setup', kind: 'tts', doctor: { status: 'setup_required' } }
    ] }));
    const output = [];
    const options = { env: { AKARI_HOME: home }, cwd: temp, log: line => output.push(line), error: line => output.push(line) };
    let result = await runRecipeCommand(['list', '--project', project, '--json'], options);
    assert.equal(result.exitCode, 0);
    const entries = JSON.parse(output.pop());
    assert.deepEqual(entries.map(item => [item.id, item.source]), [['image', 'local'], ['music', 'project']]);
    result = await runRecipeCommand(['plan', 'music', '--project', project, '--json'], options);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(output.pop()).requirements[0].candidates[0].gates, []);
    result = await runRecipeCommand(['plan', 'image', '--project', project, '--json'], options);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(output.pop()).requirements[0].candidates[0].gates.sort(), ['external-send', 'license', 'paid']);
    put(path.join(project, 'recipes'), 'speech', recipe('speech', ['speech-synthesis']));
    result = await runRecipeCommand(['plan', 'speech', '--project', project, '--json'], options);
    assert.equal(result.exitCode, 0);
    const speechPlan = JSON.parse(output.pop());
    assert.deepEqual(speechPlan.missing, []);
    assert.deepEqual(speechPlan.requirements[0].candidates.map(item => [item.id, item.auth]), [
      ['speech-unauthorized', 'unauthorized'],
      ['speech-unconfigured', 'unconfigured'],
      ['speech-setup', 'setup_required']
    ]);
    put(path.join(project, 'recipes'), 'publish', recipe('publish', ['publish']));
    result = await runRecipeCommand(['plan', 'publish', '--project', project, '--json'], options);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(JSON.parse(output.pop()).missing, ['publish']);
    result = await runRecipeCommand(['plan', 'publish', '--project', project], options);
    assert.equal(result.exitCode, 1);
    assert.equal(output.pop(), cliText('cli.recipe.plan.missingRow', {
      capability: 'publish', message: cliText('cli.recipe.plan.noCandidate') }));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('kit recipe symlink is listed, recorded and removed on uninstall', async () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'akari-kit-recipes-'));
  try {
    const home = path.join(temp, 'home');
    const kitDir = path.join(temp, 'kit');
    put(path.join(kitDir, 'recipes'), 'music', recipe('music', ['music-generation']));
    const linked = linkKitRecipes(kitDir, { recipes: [{ dir: 'recipes/music' }] }, home);
    assert.deepEqual(linked.linked, ['music']);
    const dest = path.join(home, 'tool-recipes', 'music');
    assert.equal(existsSync(dest), true);
    const listed = await runRecipeCommand(['list', '--json'], { env: { AKARI_HOME: home }, cwd: temp,
      log: () => {}, error: () => {} });
    assert.equal(listed.entries[0].source, 'kit');
    writeKitsLedger(home, { id: 'kit', kitDir, recipes: linked.linked });
    assert.deepEqual(readKitsLedger(home).kits[0].recipes, ['music']);
    assert.equal(removeKit(home, 'kit', { AKARI_HOME: home }), true);
    assert.equal(existsSync(dest), false);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
