#!/usr/bin/env node
// Regenerate the factual parts of public documents from catalogs, launcher source, skills, and tags.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { uiKeys } from './docs-facts/keys.mjs';
import { snippets } from './docs-facts/snippets.mjs';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (message) => { console.error(`gen-docs-facts: ${message}`); process.exit(1); };
const args = process.argv.slice(2);
let root = defaultRoot;
let check = false;
let print = false;
let versionOverride;
let shippedOverride;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--root') root = resolve(args[++i] ?? fail('missing --root value'));
  else if (arg === '--version') versionOverride = args[++i] ?? fail('missing --version value');
  else if (arg === '--shipped-tag') shippedOverride = args[++i] ?? fail('missing --shipped-tag value');
  else if (arg === '--check') check = true;
  else if (arg === '--print') print = true;
  else fail(`unknown option: ${arg}`);
}
if (check && print) fail('--check and --print cannot be combined');

const read = (path) => readFileSync(join(root, path), 'utf8');
const git = (...argv) => {
  const result = spawnSync('git', argv, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trimEnd() : null;
};

const semver = (tag) => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(tag);
  return match ? [...match.slice(1, 4).map(Number), match[4] ?? ''] : null;
};
const compareTags = (a, b) => {
  const av = semver(a), bv = semver(b);
  if (!av || !bv) return 0;
  for (let i = 0; i < 3; i += 1) if (av[i] !== bv[i]) return av[i] - bv[i];
  if (av[3] === bv[3]) return 0;
  if (!av[3]) return 1;
  if (!bv[3]) return -1;
  return av[3].localeCompare(bv[3], 'en', { numeric: true });
};
let selectedTag = git('describe', '--tags', '--abbrev=0', '--match', 'v*');
const tagList = git('tag', '--list', 'v*');
if (tagList) {
  for (const tag of tagList.split('\n').filter(semver)) {
    const parent = git('rev-parse', `${tag}^{commit}^`);
    if (!parent || git('merge-base', '--is-ancestor', parent, 'HEAD') === null) continue;
    if (!selectedTag || compareTags(tag, selectedTag) > 0) selectedTag = tag;
  }
}
const shippedTag = shippedOverride ?? selectedTag;
if (shippedOverride && !git('rev-parse', '--verify', `${shippedOverride}^{commit}`)) fail(`unknown shipped tag: ${shippedOverride}`);
const fallbackVersion = JSON.parse(read('apps/shell/package.json')).version;
const version = versionOverride ?? (selectedTag ? selectedTag.replace(/^v/, '') : fallbackVersion);
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) fail(`invalid version: ${version}`);
const dateTag = shippedOverride ?? selectedTag;
const dateText = dateTag ? git('show', '-s', '--format=%cI', `${dateTag}^{commit}`) : null;
const releaseDate = dateText ? new Date(dateText).toISOString().slice(0, 10) : null;

const catalogs = {};
for (const lang of ['ja', 'en']) {
  catalogs[lang] = {};
  const dir = join(root, 'packages/i18n/locales', lang);
  for (const name of readdirSync(dir).filter((name) => name.endsWith('.json')).sort()) {
    Object.assign(catalogs[lang], JSON.parse(readFileSync(join(dir, name), 'utf8')));
  }
}
const ui = { ja: {}, en: {} };
for (const lang of ['ja', 'en']) {
  for (const [fact, key] of Object.entries(uiKeys)) {
    const value = catalogs[lang][key];
    if (typeof value !== 'string') fail(`missing i18n key: ${lang}/${key}`);
    ui[lang][fact] = value;
  }
}
const catalogValue = (lang, key) => {
  const value = catalogs[lang][key];
  if (typeof value !== 'string') fail(`missing i18n key: ${lang}/${key}`);
  return value;
};
const newSource = read('packages/akari-launcher/src/new-command.mjs');
const templateSource = read('packages/akari-launcher/src/template-command.mjs');
const requireMatch = (source, pattern, label) => {
  const match = source.match(pattern);
  if (!match) fail(`launcher source changed: ${label}`);
  return match;
};
// These commands do not export their parser constants; verify the accepted spellings in source.
const newFlags = requireMatch(newSource, /argument === '(--template)' \|\| argument === '(--scaffold)'/, 'new flags');
requireMatch(templateSource, /action !== '(export)' && action !== '(list)'/, 'template actions');
requireMatch(templateSource, /action === 'export' \? '(template)' : 'list'/, 'template alias');
const { connectPaths } = await import(pathToFileURL(join(root, 'packages/akari-launcher/src/connect-command.mjs')).href);
if (typeof connectPaths !== 'function') fail('launcher does not export connectPaths');
const homeMarker = '__AKARI_DOCS_HOME__';
const credentialPaths = connectPaths({}, homeMarker);
const toTilde = (value) => {
  const normalized = value?.replaceAll('\\', '/');
  if (!normalized?.startsWith(`${homeMarker}/`)) fail('launcher credentials path is not under the default home');
  return `~${normalized.slice(homeMarker.length)}`;
};
const paths = { credentials: {
  primary: toTilde(credentialPaths.primary),
  legacy: toTilde(credentialPaths.legacy),
} };
const cli = {
  new: { usage: { ja: catalogValue('ja', 'cli.new.help.usage'), en: catalogValue('en', 'cli.new.help.usage') }, scaffold: newFlags[2], alias: newFlags[1] },
  template: { usage: { ja: catalogValue('ja', 'cli.template.help.usage'), en: catalogValue('en', 'cli.template.help.usage') },
    export: requireMatch(catalogValue('en', 'cli.template.help.usage'), /akari template export/, 'template export usage')[0],
    list: requireMatch(catalogValue('en', 'cli.template.help.usage'), /akari template list/, 'template list usage')[0],
    alias: requireMatch(catalogValue('en', 'cli.playbook.template.usage'), /akari playbook template/, 'template alias usage')[0] },
};
for (const lang of ['ja', 'en']) {
  for (const flag of [cli.new.scaffold, cli.new.alias]) if (!cli.new.usage[lang].includes(flag)) fail(`CLI usage missing ${flag}: ${lang}`);
  for (const command of [cli.template.export, cli.template.list]) if (!cli.template.usage[lang].includes(command)) fail(`CLI usage missing ${command}: ${lang}`);
}
const skillNames = readdirSync(join(root, 'skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const beta = [];
for (const name of skillNames) {
  const source = read(`skills/${name}/SKILL.md`);
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) fail(`missing frontmatter: skills/${name}/SKILL.md`);
  const declared = frontmatter[1].match(/^name:\s*["']?([^\n"']+)/m)?.[1]?.trim();
  if (declared !== name) fail(`skill name mismatch: ${name}`);
  if (!/^description:\s*.+/m.test(frontmatter[1])) fail(`missing skill description: ${name}`);
  if (/\bBETA\b/i.test(frontmatter[1])) beta.push(name);
}
const skills = { count: skillNames.length, names: skillNames, beta };
const shipped = [];
if (shippedTag) {
  for (const lang of ['ja', 'en']) {
    const historical = {};
    const files = [...new Set(Object.values(uiKeys).map((key) => `${key.split('.')[0]}.json`))];
    for (const file of files) {
      const source = git('show', `${shippedTag}:packages/i18n/locales/${lang}/${file}`);
      if (source !== null) Object.assign(historical, JSON.parse(source));
    }
    for (const [key, catalogKey] of Object.entries(uiKeys)) {
      const before = historical[catalogKey] ?? null;
      const current = ui[lang][key];
      if (before !== current) shipped.push({ lang, key, shipped: before, current });
    }
    const taggedCliSource = git('show', `${shippedTag}:packages/i18n/locales/${lang}/cli.json`);
    const taggedCli = taggedCliSource === null ? {} : JSON.parse(taggedCliSource);
    for (const [key, catalogKey, current] of [
      ['cli.new.usage', 'cli.new.help.usage', cli.new.usage[lang]],
      ['cli.template.usage', 'cli.template.help.usage', cli.template.usage[lang]],
    ]) {
      const before = taggedCli[catalogKey] ?? null;
      if (before !== current) shipped.push({ lang, key, shipped: before, current });
    }
  }
}
const facts = { meta: { version, releaseDate, shippedTag: shippedTag ?? null }, ui, cli, paths, skills, shipped };
const serialized = `${JSON.stringify(facts, null, 2)}\n`;
if (print) { process.stdout.write(serialized); process.exit(0); }

const documentPaths = ['README.md', 'README.ja.md'];
for (const name of readdirSync(join(root, 'docs')).sort()) {
  if (/^(README|introduction|getting-started|skills)(\.ja)?\.md$/.test(name)) documentPaths.push(`docs/${name}`);
}
for (const section of ['guides', 'how-to']) {
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.md')) documentPaths.push(path);
    }
  };
  walk(`docs/${section}`);
}
for (const name of skillNames) documentPaths.push(`skills/${name}/SKILL.md`);

const lineAt = (content, offset) => content.slice(0, offset).split('\n').length;
const inlinePattern = /<!-- F ([\w.-]+) -->([\s\S]*?)<!-- \/F -->/g;
const beginPattern = /<!-- BEGIN GENERATED facts:([\w.-]+) -->/g;
const endPattern = /<!-- END GENERATED facts:([\w.-]+) -->/g;
const changes = [];
const produce = (file, current) => {
  const lang = file.endsWith('.ja.md') ? 'ja' : 'en';
  let next = '';
  let cursor = 0;
  const begins = [...current.matchAll(beginPattern)];
  const ends = [...current.matchAll(endPattern)];
  for (let i = 0; i < begins.length; i += 1) {
    const begin = begins[i];
    const end = ends[i];
    if (!snippets[begin[1]]) fail(`${file}:${lineAt(current, begin.index)}: unknown snippet ${begin[1]}`);
    if (!end || end.index < begin.index || end[1] !== begin[1] || (begins[i + 1] && begins[i + 1].index < end.index)) {
      fail(`${file}:${lineAt(current, begin.index)}: mismatched or missing END for facts:${begin[1]}`);
    }
    const lineStart = current.lastIndexOf('\n', begin.index - 1) + 1;
    const endLineStart = current.lastIndexOf('\n', end.index - 1) + 1;
    const prefix = current.slice(lineStart, begin.index);
    const endPrefix = current.slice(endLineStart, end.index);
    if (prefix !== endPrefix) fail(`${file}:${lineAt(current, begin.index)}: BEGIN/END prefixes differ for facts:${begin[1]}`);
    next += current.slice(cursor, begin.index) + begin[0] + '\n';
    let value = snippets[begin[1]](facts, lang);
    if (begin[1] === 'shipped-note' && value) {
      if (file === 'README.md' || file === 'README.ja.md') value = `> [!NOTE]\n> ${value}`;
      else if (file === 'docs/getting-started.md' || file === 'docs/getting-started.ja.md') value = `> ${value}`;
    }
    if (value) next += (prefix.trim() === '>' ? value.split('\n').map((line) => `${prefix}${line}`).join('\n') : value) + '\n';
    cursor = end.index;
  }
  if (ends.length > begins.length) {
    const stray = ends[begins.length];
    fail(`${file}:${lineAt(current, stray.index)}: unmatched END for facts:${stray[1]}`);
  }
  next += current.slice(cursor);
  next = next.replace(inlinePattern, (whole, key, _old, offset) => {
    let value;
    if (key.startsWith('ui.')) value = ui[lang][key.slice(3)];
    else if (key === 'paths.credentials') value = `\`${paths.credentials.primary}\``;
    else if (key === 'paths.credentials.legacy') value = `\`${paths.credentials.legacy}\``;
    if (value === undefined) fail(`${file}:${lineAt(next, offset)}: unknown fact ${key}`);
    return `<!-- F ${key} -->${value}<!-- /F -->`;
  });
  const unpairedOpen = next.indexOf('<!-- F ');
  const validOpens = [...next.matchAll(inlinePattern)].length;
  if ((next.match(/<!-- F /g) ?? []).length !== validOpens || (next.match(/<!-- \/F -->/g) ?? []).length !== validOpens) {
    fail(`${file}:${lineAt(next, unpairedOpen)}: mismatched inline marker`);
  }
  return next;
};
for (const file of documentPaths) {
  const current = read(file);
  const next = produce(file, current);
  if (next !== current) {
    const oldLines = current.split('\n'), newLines = next.split('\n');
    let changedLine = 1;
    while (changedLine <= Math.min(oldLines.length, newLines.length) && oldLines[changedLine - 1] === newLines[changedLine - 1]) changedLine += 1;
    changes.push(`${file}:${changedLine}`);
    if (!check) writeFileSync(join(root, file), next);
  }
}
const factsPath = join(root, 'docs/facts.json');
let oldFacts, oldRaw;
try { oldRaw = readFileSync(factsPath, 'utf8'); oldFacts = JSON.parse(oldRaw); } catch { oldFacts = null; }
const hadSourceCommit = oldFacts?.meta && Object.hasOwn(oldFacts.meta, 'sourceCommit');
if (hadSourceCommit) delete oldFacts.meta.sourceCommit;
if (hadSourceCommit ? JSON.stringify(oldFacts) !== JSON.stringify(facts) : oldRaw !== serialized) {
  changes.unshift('docs/facts.json:1');
  if (!check) writeFileSync(factsPath, serialized);
}
if (check && changes.length) fail(`drift found:\n${changes.join('\n')}`);
console.log(`gen-docs-facts: ${check ? 'drift なし' : `updated ${changes.length} files`} (${skills.count} skills)`);
