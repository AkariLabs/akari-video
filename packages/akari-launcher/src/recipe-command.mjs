import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cliText } from './i18n.mjs';
import { resolveLauncherAssets } from './repo-assets.mjs';

const KIND_CAPABILITIES = Object.freeze({
  image: ['image-generation'], video: ['video-generation'], music: ['music-generation'],
  tts: ['speech-synthesis'], sns: ['publish']
});
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function parse(args) {
  if (args.length === 0 || ['--help', '-h'].includes(args[0])) return { action: 'help' };
  const action = args[0];
  if (!['list', 'plan'].includes(action)) throw new Error(cliText('cli.recipe.help.usage'));
  const id = action === 'plan' ? args[1] : null;
  if (action === 'plan' && !idPattern.test(id ?? '')) throw new Error(cliText('cli.recipe.help.usage'));
  const parsed = { action, id, json: false, project: null };
  for (let i = action === 'plan' ? 2 : 1; i < args.length; i++) {
    if (args[i] === '--json' && !parsed.json) parsed.json = true;
    else if (args[i] === '--project' && !parsed.project && args[i + 1] && !args[i + 1].startsWith('-')) parsed.project = args[++i];
    else throw new Error(cliText('cli.recipe.help.usage'));
  }
  return parsed;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function akariHome(options) {
  const env = options.env ?? process.env;
  return env.AKARI_HOME || path.join(options.home ?? env.HOME ?? os.homedir(), '.akari');
}

export async function listRecipes({ projectDir, home, schemasDir }) {
  const { validateAkariRecipe } = await import(pathToFileURL(path.join(schemasDir, 'validate-akari-recipe.mjs')).href);
  const result = new Map();
  for (const [source, shelf] of [['project', path.join(projectDir, 'recipes')], ['local', path.join(home, 'tool-recipes')]]) {
    let entries;
    try { entries = await fs.readdir(shelf, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const entry of entries) {
      if (!idPattern.test(entry.name) || result.has(entry.name)) continue;
      const file = path.join(shelf, entry.name, 'recipe.json');
      let recipe;
      try { recipe = await readJson(file); }
      catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error instanceof SyntaxError) continue; throw error; }
      if (recipe?.kind !== 'akari-recipe' || recipe.id !== entry.name || !validateAkariRecipe(recipe).ok) continue;
      result.set(entry.name, { id: recipe.id, name: recipe.name, needs: recipe.needs,
        source: source === 'local' && entry.isSymbolicLink() ? 'kit' : source, recipe });
    }
  }
  return [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function candidateGates(recipe, provider) {
  const gates = new Set(recipe.gates);
  const billing = provider.notes?.billing ?? '';
  const paidSignal = /(?:paid|purchase|per (?:image|minute|generation|request)|\$|usd|\u6709\u6599|\u8ab2\u91d1|\u5f93\u91cf)/iu.test(billing);
  const freeSignal = /(?:free|no charge|\u7121\u6599|\u7121\u511f)/iu.test(billing);
  if (billing && (paidSignal || !freeSignal)) gates.add('paid');
  if (provider.adapter?.type === 'official-api' || provider.adapter?.type === 'custom'
    || (!provider.adapter && provider.auth !== 'none')) gates.add('external-send');
  if (!provider.terms?.checked) gates.add('license');
  return [...gates];
}

export function planRecipe(recipe, connections) {
  const providers = Array.isArray(connections?.providers) ? connections.providers : [];
  const requirements = recipe.needs.map(capability => {
    const candidates = providers.filter(provider =>
      (provider.provides ?? KIND_CAPABILITIES[provider.kind] ?? []).includes(capability))
      .map(provider => ({ id: provider.id, kind: provider.kind,
        auth: provider.doctor?.status ?? 'unchecked', gates: candidateGates(recipe, provider) }));
    return { capability, candidates, ...(candidates.length ? {} : { message: cliText('cli.recipe.plan.noCandidate') }) };
  });
  return { id: recipe.id, name: recipe.name, gates: recipe.gates, requirements,
    missing: requirements.filter(item => item.candidates.length === 0).map(item => item.capability) };
}

export async function runRecipeCommand(args, options = {}) {
  const log = options.log ?? console.log;
  const error = options.error ?? console.error;
  try {
    const parsed = parse(args);
    if (parsed.action === 'help') { log(cliText('cli.recipe.help.usage')); return { exitCode: 0 }; }
    const projectDir = path.resolve(options.cwd ?? process.cwd(), parsed.project ?? options.projectRoot ?? '.');
    const assets = options.assets ?? resolveLauncherAssets();
    const schemasDir = options.schemasDir ?? assets.schemasSourceDir;
    if (!schemasDir) throw new Error(cliText('cli.recipe.error.schemasMissing'));
    const recipes = await listRecipes({ projectDir, home: akariHome(options), schemasDir });
    if (parsed.action === 'list') {
      const entries = recipes.map(({ recipe, ...entry }) => entry);
      if (parsed.json) log(JSON.stringify(entries));
      else for (const entry of entries) log(cliText('cli.recipe.list.row', { id: entry.id, name: entry.name,
        needs: entry.needs.join(', '), source: entry.source }));
      return { exitCode: 0, entries };
    }
    const selected = recipes.find(entry => entry.id === parsed.id);
    if (!selected) throw new Error(cliText('cli.recipe.error.notFound', { id: parsed.id }));
    const projectConnections = path.join(projectDir, '.akari', 'connections.json');
    let connections;
    try { connections = await readJson(projectConnections); }
    catch (cause) {
      if (cause.code !== 'ENOENT') throw cause;
      if (!assets.templateDir) throw new Error(cliText('cli.recipe.error.connectionsMissing'));
      connections = await readJson(path.join(assets.templateDir, '.akari', 'connections.json'));
    }
    const plan = planRecipe(selected.recipe, connections);
    if (parsed.json) log(JSON.stringify(plan));
    else {
      log(cliText('cli.recipe.plan.header', { id: plan.id, name: plan.name }));
      if (plan.gates.length) log(cliText('cli.recipe.plan.recipeGates', { gates: plan.gates.join(', ') }));
      for (const item of plan.requirements) {
        if (!item.candidates.length) log(cliText('cli.recipe.plan.missingRow', { capability: item.capability, message: item.message }));
        else for (const candidate of item.candidates) log(cliText('cli.recipe.plan.row', {
          capability: item.capability, id: candidate.id,
          auth: candidate.auth === 'unchecked' ? cliText('cli.recipe.auth.unchecked') : candidate.auth,
          gates: candidate.gates.join(', ') || cliText('cli.recipe.plan.noGates') }));
      }
    }
    return { exitCode: plan.missing.length ? 1 : 0, plan };
  } catch (cause) { error(cause.message); return { exitCode: 1 }; }
}
