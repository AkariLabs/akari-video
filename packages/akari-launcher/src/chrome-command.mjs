import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const usage = [
  '使い方: akari chrome install [options]',
  '',
  'オプション:',
  '  --cache-dir <dir>  Chrome の保存先（既定: ~/.cache/puppeteer）',
  '  --build-id <id>    導入する Chrome の buildId（既定: stable の最新版）',
  '  -h, --help         このヘルプを表示',
].join('\n');

class PublicError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function parseInstallArguments(argv, homeDirectory) {
  const parsed = {
    cacheDir: join(homeDirectory, '.cache', 'puppeteer'),
    buildId: undefined,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== '--cache-dir' && argument !== '--build-id') {
      throw new PublicError(`不明な引数です: ${argument}`, 2);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new PublicError(`${argument} の値がありません`, 2);
    }
    index += 1;
    if (argument === '--cache-dir') parsed.cacheDir = resolve(value);
    else parsed.buildId = value;
  }
  return parsed;
}

export async function runChromeCommand(argv, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  const error = options.error ?? ((line) => console.error(line));
  const loadBrowsers = options.loadBrowsers ?? (() => import('@puppeteer/browsers'));
  const homeDirectory = options.homeDirectory ?? homedir();

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h'
      || (argv[0] === 'install' && (argv.includes('--help') || argv.includes('-h')))) {
    log(usage);
    return { exitCode: 0 };
  }
  if (argv[0] !== 'install') {
    error(`不明なサブコマンドです: ${argv[0]}\n${usage}`);
    return { exitCode: 2 };
  }

  let parsed;
  try {
    parsed = parseInstallArguments(argv, homeDirectory);
  } catch (cause) {
    error(`${cause instanceof Error ? cause.message : String(cause)}\n${usage}`);
    return { exitCode: cause instanceof PublicError ? cause.exitCode : 1 };
  }

  let browsers;
  try {
    browsers = await loadBrowsers();
  } catch (cause) {
    error([
      `@puppeteer/browsers を読み込めないため Chrome を導入できません: ${cause instanceof Error ? cause.message : String(cause)}`,
      'システムの node がある場合は `npx puppeteer browsers install chrome` でも導入できます。',
    ].join('\n'));
    return { exitCode: 1 };
  }

  try {
    const platform = browsers.detectBrowserPlatform();
    const buildId = parsed.buildId
      ?? await browsers.resolveBuildId('chrome', platform, 'stable');
    const installed = await browsers.install({
      browser: 'chrome',
      buildId,
      cacheDir: parsed.cacheDir,
      downloadProgressCallback: 'default',
    });
    if (typeof installed?.executablePath !== 'string' || installed.executablePath.length === 0) {
      throw new Error('導入後の実行ファイルを特定できませんでした。');
    }
    log(`buildId: ${buildId}`);
    log(`実行ファイル: ${resolve(installed.executablePath)}`);
    return { exitCode: 0 };
  } catch (cause) {
    error(`Chrome の導入に失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`);
    return { exitCode: 1 };
  }
}
