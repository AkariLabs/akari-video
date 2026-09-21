// macOS 26 の SpeechAnalyzer を使う聞き取りヘルパーを prepackage でビルドし、
// extraResources の native/bin/** で同梱する。native/bin/ は git 無視のビルド物。
import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readInjectedValue(flagName, envName, fallback) {
  const flagPrefix = `--${flagName}=`;
  const fromArgv = process.argv.find(arg => arg.startsWith(flagPrefix));
  if (fromArgv) {
    return fromArgv.slice(flagPrefix.length);
  }
  if (process.env[envName]) {
    return process.env[envName];
  }
  return fallback;
}

const targetPlatform = readInjectedValue('platform', 'AKARI_TARGET_PLATFORM', process.platform);
if (targetPlatform !== 'darwin') {
  console.log(`[build-vibe-stt-helper] platform=${targetPlatform}: ビルドは不要です（macOS 専用）。`);
  process.exit(0);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const sourcePath = 'packages/akari-vibe/native/live-stt.swift';
const outputPath = 'packages/akari-vibe/native/bin/akari-vibe-stt';

try {
  mkdirSync(path.dirname(path.join(repoRoot, outputPath)), { recursive: true });
  const result = spawnSync('swiftc', [
    '-O', '-parse-as-library', '-swift-version', '5', sourcePath, '-o', outputPath
  ], { cwd: repoRoot, stdio: 'inherit', shell: false });
  if (result.error) {
    throw new Error(`swiftc の起動に失敗しました: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`swiftc が失敗しました（終了コード: ${result.status}、シグナル: ${result.signal ?? 'なし'}）。`);
  }
  if (!existsSync(path.join(repoRoot, outputPath))) {
    throw new Error(`出力ファイルがありません: ${outputPath}`);
  }
} catch (error) {
  if (process.env.AKARI_VIBE_STT_OPTIONAL === '1') {
    console.warn(`[build-vibe-stt-helper] 警告: ${error.message} ヘルパー無しでは聞き取りが使えません。`);
    process.exit(0);
  }
  console.error(`[build-vibe-stt-helper] ${error.message}`);
  process.exit(1);
}

console.log(`[build-vibe-stt-helper] ビルド完了: ${outputPath}`);
process.exit(0);
