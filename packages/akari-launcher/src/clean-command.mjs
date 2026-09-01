import { lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

import { classifyProject } from './clean-manifest.mjs';

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
    error(`edit.json が見つかりません: ${parsed.projectRoot}`);
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
    error(`プロジェクトを調べられません: ${messageOf(cause)}`);
    return { exitCode: 2 };
  }

  if (parsed.json) {
    log(JSON.stringify(classification));
  } else {
    for (const line of formatClassification(classification)) log(line);
    for (const warning of provenanceWarnings(classification)) log(warning);
  }

  if (parsed.dryRun || classification.disposable.length === 0) {
    if (!parsed.json && classification.disposable.length === 0) log('削除対象はありません。');
    return { exitCode: 0, classification, removed: [], failures: [] };
  }

  if (!parsed.yes) {
    const isTTY = options.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (!isTTY) {
      error('非 TTY では明示承認が必要です。一覧を確認し、--yes を付けて再実行してください。');
      return { exitCode: 2, classification, removed: [], failures: [] };
    }
    const answer = options.prompt ? await options.prompt() : await promptForConfirmation();
    const accepted = typeof answer === 'boolean' ? answer : /^(?:y|yes)$/iu.test(String(answer).trim());
    if (!accepted) {
      if (!parsed.json) log('削除しませんでした。プロジェクトは変更されていません。');
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
      error(`削除に失敗しました: ${entry.path} (${failure.code})`);
      continue;
    }
    try {
      await remove(target, { recursive: true, force: true });
      removed.push(entry.path);
    } catch (cause) {
      const code = errorCode(cause);
      failures.push({ path: entry.path, code });
      error(`削除に失敗しました: ${entry.path} (${code})`);
    }
  }

  if (failures.length > 0) {
    error('一部を削除できませんでした。AKARI Video と書き出し処理を終了してから再実行してください。');
    return { exitCode: 1, classification, removed, failures };
  }
  if (!parsed.json) log(`削除しました: ${removed.length} 件`);
  return { exitCode: 0, classification, removed, failures };
}

export function parseArguments(args, cwd = process.cwd()) {
  const allowed = new Set(['--dry-run', '--yes', '--json', '--help']);
  const flags = args.filter((value) => value.startsWith('-'));
  const unknown = [...new Set(flags.filter((value) => !allowed.has(value)))];
  if (unknown.length > 0) return { ok: false, message: `未知のオプションです: ${unknown.join(', ')}` };
  const positional = args.filter((value) => !value.startsWith('-'));
  if (positional.length > 1) return { ok: false, message: '引数のプロジェクトディレクトリは 1 つだけ指定できます。' };
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
    '使い方: akari clean [dir] [--dry-run] [--yes] [--json] [--help]',
    '',
    '使い捨ての中間ファイル、保持する正本、判断が必要なものを一覧します。',
    '既定では一覧だけを表示し、削除前には必ず確認します。',
    '',
    '  --dry-run  一覧だけを表示して削除しない',
    '  --yes      一覧を表示した後、削除可能なものだけを削除',
    '  --json     分類結果を JSON で表示',
    '  --help     このヘルプを表示',
  ];
}

export function formatClassification(classification) {
  const lines = [];
  for (const [className, heading] of [
    ['disposable', '削除可能:'],
    ['keep', '保持:'],
    ['undecided', '判断保留:'],
  ]) {
    lines.push(heading);
    const entries = classification[className];
    if (entries.length === 0) lines.push('  （なし）');
    for (const entry of entries) {
      const provenance = entry.provenance
        ? ` / 由来: ${entry.provenance.origin} / 生成器: ${entry.provenance.generator}`
        : '';
      lines.push(`  ${entry.path} | ${entry.files} ファイル | ${formatBytes(entry.bytes)} | ${entry.reason}${provenance}`);
    }
  }
  lines.push(`削除可能 合計 ${formatBytes(classification.totals.disposable.bytes)}`);
  return lines;
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
    .map((entry) => `[警告] 由来の計画ファイルが見当たりません: ${entry.provenance.origin}`);
}

async function promptForConfirmation() {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await readline.question('削除可能な中間ファイルだけを削除しますか? [y/N] ');
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
