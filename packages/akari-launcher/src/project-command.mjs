import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveLauncherAssets } from './repo-assets.mjs';
import { cliText } from './i18n.mjs';
import { manifestPath, readJson, readManifest, resolveWhere, sha256, writeJsonAtomic, writeManifest } from './project-manifest.mjs';

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const entries = value => Array.isArray(value) ? value : [];
const slug = value => idPattern.test(value) ? value : 'project';
const text = (key, params) => cliText(`cli.project.${key}`, params);
const missing = error => error?.code === 'ENOENT';

async function resolveAssetNode(root, node, env) {
  const suffix = node.id.startsWith('asset:') ? node.id.slice(6) : '';
  const [category, id, ...extra] = suffix.split('/');
  if (!category || !id || extra.length || [category, id].some(part => part === '.' || part === '..' || part.includes('\\'))) return null;
  const local = await resolveWhere(root, `assets/${category}/${id}`);
  if (local.exists) return local.path;
  const { resolveAssetLibraryRoots } = await import('../../creator-root/src/index.mjs');
  for (const library of resolveAssetLibraryRoots(env).read) {
    if (!await isDirectory(library)) continue;
    const found = await resolveWhere(library, `${category}/${id}`);
    if (found.exists) return found.path;
  }
  return null;
}
async function assetRevision(target) {
  const stat = await fs.stat(target);
  const candidates = stat.isDirectory()
    ? [path.join(target, '.meta.json'), path.join(target, 'meta.json')]
    : [`${target}.meta.json`];
  for (const file of candidates) {
    const meta = await readJson(file);
    const revision = meta?.version ?? meta?.revision ?? meta?.rev;
    if (Number.isInteger(revision)) return revision;
  }
  return null;
}
async function assetRevisionIsNewer(target, node) {
  const revision = await assetRevision(target);
  return revision !== null && revision > node.rev;
}

async function isDirectory(file) {
  try { return (await fs.stat(file)).isDirectory(); } catch (error) { if (missing(error)) return false; throw error; }
}
async function isFile(file) {
  try { return (await fs.stat(file)).isFile(); } catch (error) { if (missing(error)) return false; throw error; }
}
async function projectRootFor(folder) {
  const parent = path.dirname(folder);
  const project = path.dirname(parent);
  return path.basename(parent) === 'scenes' && await isDirectory(path.join(project, '.akari'))
    ? project : folder;
}
async function readLedger(file) {
  try { return await readJson(file, {}); }
  catch (error) { if (error instanceof SyntaxError) return {}; throw error; }
}
function parse(args) {
  const [action, ...rest] = args;
  if (!['sync', 'check', 'scene'].includes(action)) throw new Error(text('command.help'));
  if (action === 'scene' && rest.shift() !== 'add') throw new Error(text('command.help'));
  let project;
  let id;
  let json = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--json' && action !== 'scene') json = true;
    else if (arg === '--project' && action === 'scene' && rest[i + 1] && !rest[i + 1].startsWith('--')) project = rest[++i];
    else if (!arg.startsWith('-') && action === 'scene' && id === undefined) id = arg;
    else if (!arg.startsWith('-') && action !== 'scene' && project === undefined) project = arg;
    else throw new Error(text('error.argument', { argument: arg }));
  }
  if (action === 'scene' && !idPattern.test(id ?? '')) throw new Error(text('error.id'));
  return { action, project, id, json };
}

async function channelPeoplePath(root) {
  let cursor = path.dirname(root);
  while (cursor !== path.dirname(cursor)) {
    if (path.basename(path.dirname(cursor)) === 'channels') {
      const candidate = path.join(cursor, 'people.json');
      if (await isFile(candidate)) {
        const channel = await fs.realpath(cursor);
        const actual = await fs.realpath(candidate);
        if (actual.startsWith(`${channel}${path.sep}`)) return candidate;
      }
      break;
    }
    cursor = path.dirname(cursor);
  }
  return null;
}

async function gatherLedgers(root, sceneId, generated, edges, parentId) {
  const folder = sceneId ? path.join(root, 'scenes', sceneId) : root;
  const references = await readLedger(path.join(folder, '.akari', 'asset-references.json'));
  for (const reference of entries(Array.isArray(references) ? references : references?.references)) {
    if (typeof reference?.category !== 'string' || typeof reference?.id !== 'string') continue;
    const id = `asset:${reference.category}/${reference.id}`;
    const relative = `${sceneId ? `scenes/${sceneId}/` : ''}assets/${reference.category}/${reference.id}`;
    const local = await resolveWhere(root, relative);
    const localRevision = local.exists ? await assetRevision(local.path) : null;
    const rev = localRevision ?? (Number.isInteger(reference.revision) ? reference.revision : 0);
    generated.set(id, { id, kind: 'asset', rev: Math.max(rev, generated.get(id)?.rev ?? 0),
      ...(reference.sourceKind ? { source: reference.sourceKind } : {}), ...(local.exists ? { where: relative } : {}),
      category: reference.category, by: 'sync' });
    edges.push({ from: parentId, uses: id, by: 'sync' });
  }
  const styles = await readLedger(path.join(folder, '.akari', 'style-usage.json'));
  for (const entry of entries(Array.isArray(styles) ? styles : styles?.entries)) {
    const uid = entry?.style_uid;
    if (typeof uid !== 'string' || !uid) continue;
    const id = `style:${entry.id || uid}`;
    const rev = Number.isInteger(entry.revision) ? entry.revision : 0;
    generated.set(id, { id, kind: 'style', rev: Math.max(rev, generated.get(id)?.rev ?? 0), uid, by: 'sync' });
    edges.push({ from: parentId, uses: id, by: 'sync' });
  }
}

async function gatherDocuments(root, generated, edges, parentId) {
  const planning = path.join(root, 'planning');
  if (!await isDirectory(planning)) return;
  async function walk(folder) {
    for (const item of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, item.name);
      if (item.isDirectory()) await walk(file);
      else if (item.isFile() && !item.name.startsWith('.')) {
        const where = path.relative(root, file).split(path.sep).join('/');
        const id = `doc:${where.slice('planning/'.length)}`;
        const mtime = (await fs.stat(file)).mtime.toISOString();
        generated.set(id, { id, kind: 'doc', rev: 0, where, mtime, by: 'sync' });
        edges.push({ from: parentId, uses: id, by: 'sync' });
      }
    }
  }
  await walk(planning);
}

export async function syncProject(root) {
  const previous = await readManifest(root);
  const old = new Map(previous.nodes.map(node => [node.id, node]));
  const generated = new Map();
  const edges = [];
  const projectId = `project:${slug(path.basename(root))}`;
  generated.set(projectId, { id: projectId, kind: 'project', rev: previous.project?.revision ?? 0, by: 'sync' });
  const sceneRoot = path.join(root, 'scenes');
  const sceneIds = await isDirectory(sceneRoot)
    ? (await fs.readdir(sceneRoot, { withFileTypes: true })).filter(entry => entry.isDirectory() && idPattern.test(entry.name)).map(entry => entry.name).sort()
    : [];
  for (const id of sceneIds) {
    const sceneId = `scene:${id}`;
    const editPath = path.join(sceneRoot, id, 'edit.json');
    const edited = await isFile(editPath) ? (await fs.stat(editPath)).mtime.toISOString() : undefined;
    generated.set(sceneId, { id: sceneId, kind: 'scene', rev: 0, where: `scenes/${id}`, ...(edited ? { edited } : {}), by: 'sync' });
    edges.push({ from: projectId, uses: sceneId, by: 'sync' });
    await gatherLedgers(root, id, generated, edges, sceneId);
  }
  await gatherLedgers(root, null, generated, edges, projectId);
  const peopleFile = await isFile(path.join(root, 'people.json')) ? path.join(root, 'people.json') : await channelPeoplePath(root);
  if (peopleFile) {
    const people = await readJson(peopleFile, {});
    for (const person of entries(Array.isArray(people) ? people : people?.entries)) {
      if (typeof person?.id !== 'string' || !person.id) continue;
      const id = `person:${person.id}`;
      generated.set(id, { id, kind: 'person', rev: 0, ...(peopleFile === path.join(root, 'people.json') ? { where: `people.json#${person.id}` } : { source: 'channel' }),
        ...(person.edited ? { edited: person.edited } : {}), by: 'sync' });
      edges.push({ from: projectId, uses: id, by: 'sync' });
    }
  }
  await gatherDocuments(root, generated, edges, projectId);
  for (const [id, node] of generated) {
    const prior = old.get(id);
    if (!prior || prior.by !== 'sync') { if (prior) generated.set(id, prior); continue; }
    if (node.kind === 'person' || node.kind === 'scene') {
      node.rev = prior.rev + (node.edited !== prior.edited ? 1 : 0);
    } else if (node.kind === 'doc') {
      node.rev = prior.rev + (node.mtime !== prior.mtime ? 1 : 0);
    } else if (node.kind === 'asset' || node.kind === 'style') node.rev = Math.max(node.rev, prior.rev);
    else node.rev = prior.rev;
    generated.set(id, { ...prior, ...node });
  }
  for (const node of previous.nodes) {
    if (node.by === 'sync') continue;
    if (node.kind === 'tool-output' && typeof node.sha256 === 'string' && node.where) {
      try {
        const target = await resolveWhere(root, node.where);
        if (target.exists) {
          const actual = await sha256(target.path);
          if (actual !== node.sha256) {
            generated.set(node.id, { ...node, sha256: actual, rev: node.rev + 1 });
            continue;
          }
        }
      } catch { /* check reports a rejected or missing path */ }
    }
    generated.set(node.id, node);
  }
  const uniqueEdges = new Map();
  for (const edge of [...previous.edges.filter(edge => edge.by !== 'sync'), ...edges]) {
    const key = `${edge.from}\0${edge.uses}`;
    if (!uniqueEdges.has(key)) uniqueEdges.set(key, edge);
  }
  const manifest = { ...previous, nodes: [...generated.values()], edges: [...uniqueEdges.values()] };
  const changed = await writeManifest(root, manifest);
  const counts = {};
  for (const node of manifest.nodes) counts[node.kind] = (counts[node.kind] ?? 0) + 1;
  return { changed, counts, nodes: manifest.nodes.length, edges: manifest.edges.length };
}

export async function checkProject(root, { env = process.env } = {}) {
  if (!await isFile(manifestPath(root))) return { absent: true, exitCode: 0 };
  const manifest = await readManifest(root);
  const findings = [];
  const add = (code, severity, message, extra = {}) => findings.push({ code, severity, ...extra, message });
  const nodes = new Map(manifest.nodes.map(node => [node.id, node]));
  for (const edge of manifest.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.uses)) add('MISSING_NODE', 'error', text('finding.missingNode', { from: edge.from, uses: edge.uses }), { edge });
    if (edge.from === edge.uses) add('SELF_REFERENCE', 'error', text('finding.selfReference', { id: edge.from }), { edge });
  }
  const adjacency = new Map();
  for (const edge of manifest.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.uses) || edge.from === edge.uses) continue;
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge.uses);
  }
  const color = new Map();
  const visit = id => {
    color.set(id, 1);
    for (const next of adjacency.get(id) ?? []) {
      if (color.get(next) === 1) add('CYCLE', 'error', text('finding.cycle', { from: id, uses: next }), { edge: { from: id, uses: next } });
      else if (!color.has(next)) visit(next);
    }
    color.set(id, 2);
  };
  for (const id of nodes.keys()) if (!color.has(id)) visit(id);
  for (const node of manifest.nodes) {
    if (node.kind === 'asset' && !node.where) {
      try {
        const target = await resolveAssetNode(root, node, env);
        if (!target) {
          const unacquired = node.source === 'lab';
          add(unacquired ? 'UNACQUIRED' : 'MISSING_WHERE', unacquired ? 'warning' : 'error',
            text(unacquired ? 'finding.unacquired' : 'finding.missingWhere', { id: node.id }), { node: node.id });
        } else if (await assetRevisionIsNewer(target, node)) add('STALE', 'info', text('finding.stale', { id: node.id }), { node: node.id });
      } catch { add('INVALID_WHERE', 'error', text('finding.invalidWhere', { id: node.id }), { node: node.id }); }
      continue;
    }
    if (node.kind === 'person' && node.source === 'channel' && !node.where) {
      const channelFile = await channelPeoplePath(root);
      const people = channelFile ? await readJson(channelFile, {}) : {};
      const person = entries(people?.entries).find(entry => entry.id === node.id.slice(7));
      if (!person) add('MISSING_WHERE', 'error', text('finding.missingWhere', { id: node.id }), { node: node.id });
      else if (node.edited && person.edited && Date.parse(person.edited) > Date.parse(node.edited)) add('STALE', 'info', text('finding.stale', { id: node.id }), { node: node.id });
      continue;
    }
    if (!node.where) continue;
    try {
      const target = await resolveWhere(root, node.where);
      if (!target.exists) {
        const unacquired = node.kind === 'asset' && node.source === 'lab';
        add(unacquired ? 'UNACQUIRED' : 'MISSING_WHERE', unacquired ? 'warning' : 'error', text(unacquired ? 'finding.unacquired' : 'finding.missingWhere', { id: node.id }), { node: node.id });
        continue;
      }
      if (node.kind === 'person' && target.fragment) {
        const people = await readJson(target.path, {});
        const person = entries(people?.entries).find(entry => entry.id === target.fragment);
        if (!person) add('MISSING_WHERE', 'error', text('finding.missingWhere', { id: node.id }), { node: node.id });
        else if (node.edited && person.edited && Date.parse(person.edited) > Date.parse(node.edited)) add('STALE', 'info', text('finding.stale', { id: node.id }), { node: node.id });
      }
      if (node.kind === 'doc' || node.kind === 'scene') {
        const file = node.kind === 'scene' ? path.join(target.path, 'edit.json') : target.path;
        const recorded = node.kind === 'doc' ? (node.mtime ?? node.edited) : node.edited;
        if (await isFile(file) && recorded && (await fs.stat(file)).mtimeMs > Date.parse(recorded) + 1) add('STALE', 'info', text('finding.stale', { id: node.id }), { node: node.id });
      }
      if (node.kind === 'asset' && await assetRevisionIsNewer(target.path, node)) add('STALE', 'info', text('finding.stale', { id: node.id }), { node: node.id });
      if (node.kind === 'tool-output' && node.sha256 && await isFile(target.path) && await sha256(target.path) !== node.sha256) add('STALE', 'info', text('finding.stale', { id: node.id }), { node: node.id });
    } catch {
      add('INVALID_WHERE', 'error', text('finding.invalidWhere', { id: node.id }), { node: node.id });
    }
  }
  const summary = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) summary[finding.severity]++;
  const report = { version: 0, checkedAt: new Date().toISOString(), summary, findings };
  await resolveWhere(root, '.akari/reports/manifest-check.json');
  await writeJsonAtomic(path.join(root, '.akari', 'reports', 'manifest-check.json'), report);
  return { ...report, exitCode: summary.error ? 1 : 0 };
}

export async function addScene(root, id, assets = resolveLauncherAssets()) {
  if (!idPattern.test(id)) throw new Error(text('error.id'));
  const scenes = path.join(root, 'scenes');
  await fs.mkdir(scenes, { recursive: true });
  await resolveWhere(root, 'scenes');
  const target = path.join(scenes, id);
  await fs.mkdir(target); // EEXIST is a hard failure, including a symlink.
  try {
    if (!assets.scaffoldModulePath || !assets.templateDir) throw new Error(text('error.template'));
    const scaffold = await import(pathToFileURL(assets.scaffoldModulePath).href);
    for (const name of ['assets', 'planning', '.akari']) {
      const source = path.join(assets.templateDir, name);
      if (await isDirectory(source)) await scaffold.copyTemplateTree(source, path.join(target, name));
      else await fs.mkdir(path.join(target, name), { recursive: true });
    }
    const { default: editStore } = await import('../../edit-store/lib/index.js');
    await writeJsonAtomic(path.join(target, 'edit.json'), editStore.createEmptyEditV2());
    await writeJsonAtomic(path.join(target, 'captions.json'), []);
    const manifest = await readManifest(root);
    const nodeId = `scene:${id}`;
    if (!manifest.nodes.some(node => node.id === nodeId)) {
      const edited = (await fs.stat(path.join(target, 'edit.json'))).mtime.toISOString();
      manifest.nodes.push({ id: nodeId, kind: 'scene', rev: 0, where: `scenes/${id}`, edited, by: 'sync' });
    }
    const projectId = `project:${slug(path.basename(root))}`;
    if (!manifest.nodes.some(node => node.id === projectId)) manifest.nodes.push({ id: projectId, kind: 'project', rev: manifest.project?.revision ?? 0, by: 'sync' });
    if (!manifest.edges.some(edge => edge.from === projectId && edge.uses === nodeId)) manifest.edges.push({ from: projectId, uses: nodeId, by: 'sync' });
    await writeManifest(root, manifest);
    return { id, path: target };
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true });
    throw error;
  }
}

export async function runProjectCommand(args, options = {}) {
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;
  if (args.includes('--help') || args.includes('-h') || !args.length) { log(text('command.help')); return { exitCode: 0 }; }
  try {
    const parsed = parse(args);
    const root = await projectRootFor(path.resolve(options.cwd ?? process.cwd(), parsed.project ?? '.'));
    if (!await isDirectory(root) || (!await isDirectory(path.join(root, '.akari')) && !await isFile(path.join(root, 'edit.json')))) {
      throw new Error(text('error.project', { path: root }));
    }
    if (parsed.action === 'sync') {
      const result = await syncProject(root);
      log(parsed.json ? JSON.stringify(result) : text('result.sync', { counts: Object.entries(result.counts).map(([kind, count]) => `${kind}:${count}`).join(' '), edges: result.edges }));
      return { exitCode: 0, result };
    }
    if (parsed.action === 'check') {
      const result = await checkProject(root, { env: options.env ?? process.env });
      log(parsed.json ? JSON.stringify(result) : result.absent ? text('result.absent') : text('result.check', result.summary));
      return { exitCode: result.exitCode, result };
    }
    const result = await addScene(root, parsed.id, options.assets ?? resolveLauncherAssets());
    log(text('result.scene', { id: result.id }));
    return { exitCode: 0, result };
  } catch (error) {
    logError(error?.code === 'EEXIST' ? text('error.exists') : error instanceof Error ? error.message : String(error));
    return { exitCode: 1 };
  }
}
