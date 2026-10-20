import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { cliText } from './i18n.mjs';
import { resolveRuntimePaths } from './runtime-diagnostics.mjs';

// 値を 1 つ取るオプション。プロジェクトの位置引数と取り違えないよう読み飛ばす。
const VALUE_FLAGS = new Set([
  '--engine',
  '--silence-error-seconds',
  '--max-volume-error-db',
  '--caption-silence-warn-percent',
  '--declarations',
  '--ffprobe'
]);

export function lintHelp() {
  return [
    cliText('cli.lint.help.usage'),
    '',
    cliText('cli.lint.help.description'),
    cliText('cli.lint.help.project'),
    cliText('cli.lint.help.fix'),
    cliText('cli.lint.help.media'),
    cliText('cli.lint.help.json'),
    cliText('cli.lint.help.engine'),
    cliText('cli.lint.help.help')
  ];
}

function hasProjectArgument(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') return index + 1 < argv.length;
    if (VALUE_FLAGS.has(argument)) {
      index += 1;
      continue;
    }
    if (argument.startsWith('-')) continue;
    return true;
  }
  return false;
}

/**
 * `akari lint [<project>] [--fix] ...` — 決定論的な edit-lint CLI をそのまま呼ぶ。
 * 既定では `--no-reports` を付けて一切書き込まない。`--fix` のときだけ edit-lint の
 * 修正経路（退避・差分・再検査）を通す。
 */
export async function runLintCommand(argv, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  const error = options.error ?? ((line) => console.error(line));

  if (argv.includes('--help') || argv.includes('-h')) {
    for (const line of lintHelp()) log(line);
    return { exitCode: 0 };
  }

  const runtime = options.runtime ?? resolveRuntimePaths({ env: options.env ?? process.env });
  const editLintPath = options.editLintPath ?? runtime.edit_lint?.path ?? null;
  if (!editLintPath || !existsSync(editLintPath)) {
    error(cliText('cli.lint.error.scriptMissing'));
    return { exitCode: 2 };
  }

  const forwarded = [...argv];
  if (!hasProjectArgument(forwarded)) forwarded.push('.');
  if (!forwarded.includes('--fix')) forwarded.push('--no-reports');

  const env = { ...(options.env ?? process.env) };
  const electron = options.electronRuntime ?? Boolean(process.versions.electron);
  if (electron && env.ELECTRON_RUN_AS_NODE !== '1') env.ELECTRON_RUN_AS_NODE = '1';

  const spawn = options.spawn ?? spawnSync;
  const result = spawn(options.execPath ?? process.execPath, [editLintPath, ...forwarded], {
    stdio: options.stdio ?? 'inherit',
    cwd: options.cwd ?? process.cwd(),
    env
  });
  return {
    exitCode: typeof result?.status === 'number' ? result.status : 2,
    stdout: result?.stdout,
    stderr: result?.stderr
  };
}
