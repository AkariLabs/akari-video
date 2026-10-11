#!/usr/bin/env node
// prepack の追跡ファイル選択と shell の extraResources filter を再現し、公開入口から相対 import を辿る。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { discoverCheckoutCapabilitySources } from '../../packages/akari-launcher/src/capability-sources.mjs';
import { tracePackageClosure } from '../../apps/shell/resources/scripts/cross-package-closure.mjs';
import { globToRegExp } from '../release/check-packaged-imports.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const codeFile = /\.(?:js|mjs|cjs)$/u;

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(file);
    return entry.isFile() ? [file] : [];
  });
}

function exportTargets(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(exportTargets);
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(exportTargets);
}

function publicEntries(repoRoot, selected) {
  const entries = new Set();
  for (const relative of selected) {
    if (!/^packages\/[^/]+\/package\.json$/u.test(relative)) continue;
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'));
    const packageDir = path.posix.dirname(relative);
    const targets = [
      ...exportTargets(manifest.bin),
      ...exportTargets(manifest.main),
      ...exportTargets(manifest.exports),
    ];
    for (const target of targets) {
      if (target.includes('*')) continue;
      const candidate = path.posix.normalize(path.posix.join(packageDir, target));
      if (!candidate.startsWith(`${packageDir}/`) || !codeFile.test(candidate)) continue;
      if (existsSync(path.join(repoRoot, candidate))) entries.add(candidate);
    }
  }
  return [...entries];
}

function vendorSelection(repoRoot, vendorSources, tracked) {
  const present = tracked.filter(relative => existsSync(path.join(repoRoot, relative)));
  const capability = discoverCheckoutCapabilitySources(repoRoot, {
    trackedFiles: present,
    includeBinTargets: false,
  });
  return new Set([...present.filter(relative => vendorSources.some(source =>
    relative === source || relative.startsWith(`${source}/`))), ...capability]
    .filter(relative => path.basename(relative) !== '.gitignore'));
}

function resourceSelection(repoRoot, shell) {
  const selected = new Set();
  const shellDir = path.join(repoRoot, 'apps/shell');
  for (const entry of shell.build?.extraResources ?? []) {
    if (typeof entry !== 'object' || !/^(?:packages|skills)\//u.test(entry.to ?? '')) continue;
    const from = path.resolve(shellDir, entry.from);
    if (!existsSync(from)) continue; // package 前に生成されるファイルはここでは検査しない。
    const patterns = (entry.filter ?? ['**/*']).map(globToRegExp);
    const files = statSync(from).isDirectory() ? walk(from) : [from];
    for (const file of files) {
      const relative = path.relative(from, file).split(path.sep).join('/');
      if (!patterns.some(pattern => pattern.test(relative))) continue;
      selected.add(path.posix.join(entry.to, relative));
    }
  }
  return selected;
}

async function checkClosure({ repoRoot, selected, roots, label, sourcePath }) {
  const virtual = new Map([...selected].map(relative => [path.join(repoRoot, relative),
    path.join(repoRoot, sourcePath(relative))]));
  const directories = new Set();
  for (const file of virtual.keys()) {
    let directory = path.dirname(file);
    while (directory.startsWith(repoRoot) && directory !== repoRoot) {
      directories.add(directory);
      directory = path.dirname(directory);
    }
  }
  const result = await tracePackageClosure({
    roots: [...new Set(roots)].map(relative => path.join(repoRoot, relative)),
    packagesRoot: repoRoot,
    // Optional dynamic imports are reported by the existing packaged-imports check as references.
    readFile: file => readFileSync(virtual.get(file), 'utf8')
      .replace(/\bimport\s*\(\s*(['"`])[^'"`\r\n]+\1\s*\)/gu, 'void 0'),
    isFile: file => virtual.has(file),
    isDirectory: directory => directories.has(directory),
  });
  return {
    files: result.files.length,
    missing: result.unresolved.filter(issue => ['missing', 'outside', 'package-main'].includes(issue.reason))
      .map(issue => `${label}: ${path.relative(repoRoot, issue.file)} -> ${issue.specifier ?? '(entry)'} (${issue.reason})`),
  };
}

export async function checkDistributionImportClosure({ repoRoot = defaultRoot, shellPackagePath } = {}) {
  const root = realpathSync(repoRoot);
  const shellPath = shellPackagePath ? path.resolve(shellPackagePath) : path.join(root, 'apps/shell/package.json');
  const shell = JSON.parse(readFileSync(shellPath, 'utf8'));
  const vendorFile = path.join(root, 'packages/akari-launcher/src/vendor-sources.mjs');
  const { VENDOR_SOURCES } = await import(pathToFileURL(vendorFile).href);
  const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z'], { maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8').split('\0').filter(Boolean);
  const vendor = vendorSelection(root, VENDOR_SOURCES, tracked);
  const launcher = tracked.filter(relative => /^packages\/akari-launcher\/(?:bin|src)\/.*\.(?:js|mjs|cjs)$/u.test(relative)
    && existsSync(path.join(root, relative)));
  const vendorPrefix = 'packages/akari-launcher/vendor/';
  const vendorVirtual = new Set([...launcher, ...[...vendor].map(relative => `${vendorPrefix}${relative}`)]);
  const vendorRoots = [
    ...launcher,
    ...publicEntries(root, vendor).filter(relative => vendor.has(relative)).map(relative => `${vendorPrefix}${relative}`),
  ];
  const vendorResult = await checkClosure({
    repoRoot: root,
    selected: vendorVirtual,
    roots: vendorRoots,
    label: 'vendor',
    sourcePath: relative => relative.startsWith(vendorPrefix) ? relative.slice(vendorPrefix.length) : relative,
  });

  const resources = resourceSelection(root, shell);
  const resourceRoots = publicEntries(root, resources).filter(relative => resources.has(relative));
  const resourceResult = await checkClosure({
    repoRoot: root,
    selected: resources,
    roots: resourceRoots,
    label: 'Resources',
    sourcePath: relative => relative,
  });
  return { missing: [...vendorResult.missing, ...resourceResult.missing],
    vendorFiles: vendorResult.files, resourceFiles: resourceResult.files };
}

async function main(args) {
  let repoRoot = defaultRoot;
  let shellPackagePath;
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === '--root' && args[i + 1]) repoRoot = args[i + 1];
    else if (args[i] === '--shell-package' && args[i + 1]) shellPackagePath = args[i + 1];
    else throw new Error('usage: check-distribution-import-closure.mjs [--root <directory>] [--shell-package <file>]');
  }
  const result = await checkDistributionImportClosure({ repoRoot, shellPackagePath });
  for (const issue of result.missing) console.error(`[distribution-import-closure] ${issue}`);
  if (result.missing.length) process.exitCode = 1;
  else console.log(`[distribution-import-closure] OK: vendor ${result.vendorFiles} files, Resources ${result.resourceFiles} files`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`[distribution-import-closure] ${error.message}`);
    process.exitCode = 1;
  });
}
