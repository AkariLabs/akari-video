import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

import { resolveLauncherAssets } from './repo-assets.mjs';
import { cliText } from './i18n.mjs';

const require = createRequire(import.meta.url);

export async function runMigrateCommand(args, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  const error = options.error ?? ((line) => console.error(line));
  const cwd = options.cwd ?? process.cwd();
  const parsed = parseArguments(args, cwd);
  if (!parsed.ok) {
    error(parsed.message);
    return { exitCode: 2 };
  }
  if (parsed.help) {
    for (const line of migrateHelp()) log(line);
    return { exitCode: 0 };
  }
  const projectRoot = parsed.projectRoot;
  const editPath = path.join(projectRoot, 'edit.json');
  const captionsPath = path.join(projectRoot, 'captions.json');
  const readText = options.readFile ?? readFile;
  let text;
  try {
    text = await readText(editPath, 'utf8');
  } catch (cause) {
    error(cliText('cli.migrate.error.editUnreadable', { path: editPath, message: messageOf(cause) }));
    return { exitCode: 2 };
  }
  const migrate = options.migrate ?? loadMigrateModule(options.assets ?? resolveLauncherAssets());
  let captionsRoot;
  try {
    captionsRoot = JSON.parse(await readText(captionsPath, 'utf8'));
  } catch {
    // captions.json の不在・読み取り失敗・壊れた JSON は cue なしとして移行を続ける。
  }
  const hasCaptions = migrate.captionsHaveRenderableCues(captionsRoot);
  let editVersion;
  try {
    editVersion = migrate.detectEditVersion(JSON.parse(text));
  } catch {
    // JSON error の文言は従来どおり planMigration に一元化する。
  }
  const proposal = editVersion === 2
    ? migrate.planV2Normalization(projectRoot, editPath, text, { now: options.now })
    : migrate.planMigration(projectRoot, editPath, text, { hasCaptions, now: options.now });
  if (proposal.ok === false) {
    if (parsed.json) {
      log(JSON.stringify({ ok: false, error: cliText('cli.migrate.error.cannotConvertJson'), blockers: proposal.blockers }));
    } else {
      error(cliText('cli.migrate.error.cannotConvert'));
      for (const blocker of proposal.blockers) error(`- ${blocker}`);
    }
    return { exitCode: 2 };
  }
  if (proposal.noop === true) {
    if (parsed.json) log(JSON.stringify({ ok: true, noop: true, version: proposal.version }));
    else log(cliText('cli.migrate.status.noop'));
    return { exitCode: 0, proposal };
  }
  if (parsed.json) {
    log(JSON.stringify({
      ok: true, dryRun: parsed.dryRun, version: proposal.emptyProject ? null : proposal.version,
      ...(proposal.emptyProject ? { emptyProject: true } : {}),
      filePath: proposal.filePath, backupPath: proposal.backupPath, changes: proposal.changes
    }));
  } else {
    log(proposal.emptyProject
      ? cliText('cli.migrate.proposal.empty', { path: proposal.filePath })
      : cliText('cli.migrate.proposal.convert', { path: proposal.filePath, version: proposal.version, suffix: proposal.version === 2 ? cliText('cli.migrate.proposal.normalizeSuffix') : ' -> 2' }));
    for (const change of proposal.changes) log(`- ${change.path}: ${change.note}`);
    log(cliText('cli.migrate.proposal.backup', { path: proposal.backupPath }));
  }
  if (parsed.dryRun) {
    if (!parsed.json) log(cliText('cli.migrate.status.dryRun'));
    return { exitCode: 0, proposal };
  }
  if (!parsed.yes) {
    const isTTY = options.isTTY ?? (process.stdin.isTTY && process.stdout.isTTY);
    if (!isTTY) {
      error(cliText('cli.migrate.error.approvalRequired'));
      return { exitCode: 2, proposal };
    }
    const accepted = options.confirm
      ? await options.confirm()
      : await promptForConfirmation();
    if (!accepted) {
      if (!parsed.json) log(cliText('cli.migrate.status.cancelled'));
      return { exitCode: 0, proposal };
    }
  }
  await migrate.applyMigration(proposal);
  if (!parsed.json) {
    log(proposal.emptyProject
      ? cliText('cli.migrate.status.initialized', { path: proposal.backupPath })
      : proposal.version === 2
      ? cliText('cli.migrate.status.normalized', { path: proposal.backupPath })
      : cliText('cli.migrate.status.converted', { path: proposal.backupPath }));
  }
  return { exitCode: 0, proposal };
}

function loadMigrateModule(assets) {
  const modulePath = path.join(assets.repoRoot, 'packages', 'edit-store', 'lib', 'migrate', 'index.js');
  try {
    return require(modulePath);
  } catch (cause) {
    throw new Error(cliText('cli.migrate.error.moduleUnreadable', { path: modulePath, message: messageOf(cause) }));
  }
}

function parseArguments(args, cwd) {
  const flags = new Set(args.filter(value => value.startsWith('-')));
  const unknown = [...flags].filter(value => !['--yes', '-y', '--dry-run', '--json', '--help', '-h'].includes(value));
  if (unknown.length > 0) return { ok: false, message: cliText('cli.migrate.error.unknownOption', { options: unknown.join(', ') }) };
  const positional = args.filter(value => !value.startsWith('-'));
  if (positional.length > 1) return { ok: false, message: cliText('cli.migrate.error.multipleRoots') };
  return {
    ok: true,
    help: flags.has('--help') || flags.has('-h'),
    yes: flags.has('--yes') || flags.has('-y'),
    dryRun: flags.has('--dry-run'),
    json: flags.has('--json'),
    projectRoot: path.resolve(cwd, positional[0] ?? '.')
  };
}

async function promptForConfirmation() {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(cliText('cli.migrate.prompt.confirm'));
    return /^(?:y|yes)$/iu.test(answer.trim());
  } finally {
    readline.close();
  }
}

export function migrateHelp() {
  return [
    cliText('cli.migrate.help.usage'),
    '',
    cliText('cli.migrate.help.description'),
    cliText('cli.migrate.help.default'),
    '',
    ...['yes', 'dryRun', 'json', 'help'].map((name) => cliText(`cli.migrate.help.${name}`))
  ];
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
