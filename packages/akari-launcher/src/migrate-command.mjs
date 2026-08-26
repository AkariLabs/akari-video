import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

import { resolveLauncherAssets } from './repo-assets.mjs';

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
    error(`edit.json を読めません: ${editPath} (${messageOf(cause)})`);
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
  const proposal = migrate.planMigration(projectRoot, editPath, text, { hasCaptions, now: options.now });
  if (proposal.ok === false) {
    if (parsed.json) {
      log(JSON.stringify({ ok: false, error: 'このプロジェクトは変換できません', blockers: proposal.blockers }));
    } else {
      error('このプロジェクトは変換できません。');
      for (const blocker of proposal.blockers) error(`- ${blocker}`);
    }
    return { exitCode: 2 };
  }
  if (parsed.json) {
    log(JSON.stringify({
      ok: true, dryRun: parsed.dryRun, version: proposal.version,
      filePath: proposal.filePath, backupPath: proposal.backupPath, changes: proposal.changes
    }));
  } else {
    log(`変換対象: ${proposal.filePath} (version ${proposal.version} -> 2)`);
    for (const change of proposal.changes) log(`- ${change.path}: ${change.note}`);
    log(`変換前の退避先: ${proposal.backupPath}`);
  }
  if (parsed.dryRun) {
    if (!parsed.json) log('--dry-run のため、ファイルは変更しません。');
    return { exitCode: 0, proposal };
  }
  if (!parsed.yes) {
    const isTTY = options.isTTY ?? (process.stdin.isTTY && process.stdout.isTTY);
    if (!isTTY) {
      error('非 TTY では明示承認が必要です。内容を確認し、--yes を付けて再実行してください。');
      return { exitCode: 2, proposal };
    }
    const accepted = options.confirm
      ? await options.confirm()
      : await promptForConfirmation();
    if (!accepted) {
      if (!parsed.json) log('変換しませんでした。edit.json は変更されていません。');
      return { exitCode: 0, proposal };
    }
  }
  await migrate.applyMigration(proposal);
  if (!parsed.json) log(`version 2 へ変換しました。元ファイル: ${proposal.backupPath}`);
  return { exitCode: 0, proposal };
}

function loadMigrateModule(assets) {
  const modulePath = path.join(assets.repoRoot, 'packages', 'edit-store', 'lib', 'migrate', 'index.js');
  try {
    return require(modulePath);
  } catch (cause) {
    throw new Error(`変換器を読み込めません: ${modulePath} (${messageOf(cause)})`);
  }
}

function parseArguments(args, cwd) {
  const flags = new Set(args.filter(value => value.startsWith('-')));
  const unknown = [...flags].filter(value => !['--yes', '-y', '--dry-run', '--json', '--help', '-h'].includes(value));
  if (unknown.length > 0) return { ok: false, message: `未知のオプションです: ${unknown.join(', ')}` };
  const positional = args.filter(value => !value.startsWith('-'));
  if (positional.length > 1) return { ok: false, message: '引数のプロジェクトディレクトリは 1 つだけ指定できます。' };
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
    const answer = await readline.question('上記の内容で version 2 へ変換しますか? [y/N] ');
    return /^(?:y|yes)$/iu.test(answer.trim());
  } finally {
    readline.close();
  }
}

export function migrateHelp() {
  return [
    '使い方: akari migrate [dir] [--yes] [--dry-run] [--json]',
    '',
    'v0/v1 の edit.json を v2 へ片道変換します。',
    '既定は変更内容を表示して y/n で確認し、変換前の全文を .akari/backup/ へ退避します。',
    '',
    '  --yes, -y   表示後の確認を省略',
    '  --dry-run   提案の表示だけで書き込まない',
    '  --json      機械可読な JSON を出力',
    '  --help, -h  このヘルプを表示'
  ];
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
