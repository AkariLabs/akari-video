import { lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

import { classifyProject } from './clean-manifest.mjs';
import { cliText, cliValue } from './i18n.mjs';

export async function runCleanCommand(args, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  const error = options.error ?? ((line) => console.error(line));
  const cwd = options.cwd ?? process.cwd();
  const parsed = parseArguments(args, cwd);
  if (!parsed.ok) {
    error(parsed.message);
    for (const line of cleanHelp()) error(line);
    return { exitCode: 2 };
  }
  if (parsed.help) {
    for (const line of cleanHelp()) log(line);
    return { exitCode: 0 };
  }

  const statPath = options.lstat ?? lstat;
  try {
    const editStat = await statPath(path.join(parsed.projectRoot, 'edit.json'));
    if (!editStat.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
  } catch {
    error(cliText('cli.clean.error.editMissing', { root: parsed.projectRoot }));
    return { exitCode: 2 };
  }

  let classification;
  try {
    classification = await (options.classify ?? classifyProject)(parsed.projectRoot, {
      now: options.now,
      lstat: options.lstat,
      readdir: options.readdir,
      readFile: options.readFile,
    });
  } catch (cause) {
    error(cliText('cli.clean.error.inspectFailed', { message: messageOf(cause) }));
    return { exitCode: 2 };
  }

  if (parsed.json) {
    log(JSON.stringify(localizeClassification(classification)));
  } else {
    for (const line of formatClassification(classification)) log(line);
    for (const warning of provenanceWarnings(classification)) log(warning);
  }

  if (parsed.dryRun || classification.disposable.length === 0) {
    if (!parsed.json && classification.disposable.length === 0) log(cliText('cli.clean.status.nothingToDelete'));
    return { exitCode: 0, classification, removed: [], failures: [] };
  }

  if (!parsed.yes) {
    const isTTY = options.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (!isTTY) {
      error(cliText('cli.clean.error.approvalRequired'));
      return { exitCode: 2, classification, removed: [], failures: [] };
    }
    const answer = options.prompt ? await options.prompt() : await promptForConfirmation();
    const accepted = typeof answer === 'boolean' ? answer : /^(?:y|yes)$/iu.test(String(answer).trim());
    if (!accepted) {
      if (!parsed.json) log(cliText('cli.clean.status.cancelled'));
      return { exitCode: 0, classification, removed: [], failures: [] };
    }
  }

  const remove = options.remove ?? ((target) => rm(target, { recursive: true, force: true }));
  const removed = [];
  const failures = [];
  for (const entry of classification.disposable) {
    const target = path.resolve(parsed.projectRoot, entry.path);
    if (!isInside(parsed.projectRoot, target) || target === parsed.projectRoot) {
      const failure = { path: entry.path, code: 'OUTSIDE_PROJECT' };
      failures.push(failure);
      error(cliText('cli.clean.error.deleteFailed', { path: entry.path, code: failure.code }));
      continue;
    }
    try {
      await remove(target, { recursive: true, force: true });
      removed.push(entry.path);
    } catch (cause) {
      const code = errorCode(cause);
      failures.push({ path: entry.path, code });
      error(cliText('cli.clean.error.deleteFailed', { path: entry.path, code }));
    }
  }

  if (failures.length > 0) {
    error(cliText('cli.clean.error.partialDelete'));
    return { exitCode: 1, classification, removed, failures };
  }
  if (!parsed.json) log(cliText('cli.clean.status.deleted', { count: removed.length, n: removed.length }));
  return { exitCode: 0, classification, removed, failures };
}

export function parseArguments(args, cwd = process.cwd()) {
  const allowed = new Set(['--dry-run', '--yes', '--json', '--help']);
  const flags = args.filter((value) => value.startsWith('-'));
  const unknown = [...new Set(flags.filter((value) => !allowed.has(value)))];
  if (unknown.length > 0) return { ok: false, message: cliText('cli.clean.error.unknownOption', { options: unknown.join(', ') }) };
  const positional = args.filter((value) => !value.startsWith('-'));
  if (positional.length > 1) return { ok: false, message: cliText('cli.clean.error.multipleRoots') };
  const flagSet = new Set(flags);
  return {
    ok: true,
    help: flagSet.has('--help'),
    yes: flagSet.has('--yes'),
    dryRun: flagSet.has('--dry-run'),
    json: flagSet.has('--json'),
    projectRoot: path.resolve(cwd, positional[0] ?? '.'),
  };
}

export function cleanHelp() {
  return [
    cliText('cli.clean.help.usage'),
    '',
    cliText('cli.clean.help.description'),
    cliText('cli.clean.help.default'),
    '',
    ...['dryRun', 'yes', 'json', 'help'].map((name) => cliText(`cli.clean.help.${name}`)),
  ];
}

export function formatClassification(classification) {
  const lines = [];
  for (const [className, heading] of [
    ['disposable', cliText('cli.clean.category.disposable')],
    ['keep', cliText('cli.clean.category.keep')],
    ['undecided', cliText('cli.clean.category.undecided')],
  ]) {
    lines.push(heading);
    const entries = classification[className];
    if (entries.length === 0) lines.push(cliText('cli.clean.category.empty'));
    for (const entry of entries) {
      const provenance = entry.provenance
        ? cliText('cli.clean.entry.provenance', { origin: entry.provenance.origin, generator: entry.provenance.generator })
        : '';
      lines.push(cliText('cli.clean.entry.row', { path: entry.path, files: entry.files, n: entry.files, bytes: formatBytes(entry.bytes), reason: cliValue('cli.clean.reason.', entry.reason), provenance }));
    }
  }
  lines.push(cliText('cli.clean.category.total', { bytes: formatBytes(classification.totals.disposable.bytes) }));
  return lines;
}

function localizeClassification(classification) {
  const result = { ...classification };
  for (const category of ['disposable', 'keep', 'undecided']) {
    result[category] = classification[category].map((entry) => ({
      ...entry,
      reason: cliValue('cli.clean.reason.', entry.reason),
      ...(entry.held_reason ? { held_reason: cliValue('cli.clean.reason.', entry.held_reason) } : {}),
    }));
  }
  return result;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(1)} ${unit}`;
}

function provenanceWarnings(classification) {
  return classification.keep
    .filter((entry) => entry.provenance?.origin_exists === false)
    .map((entry) => cliText('cli.clean.warning.provenanceMissing', { origin: entry.provenance.origin }));
}

async function promptForConfirmation() {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await readline.question(cliText('cli.clean.prompt.delete'));
  } finally {
    readline.close();
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function errorCode(error) {
  if (error && typeof error === 'object') return String(error.code ?? error.errno ?? messageOf(error));
  return messageOf(error);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
