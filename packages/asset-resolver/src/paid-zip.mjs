// 有料素材のダウンロード（設計契約: 非公開の内部記録にある store-commerce-v0 契約 §6/§8）。
// entitled 判定を通った後だけ呼ばれる想定 — `/api/store/v1/download/<id>` から zip を取得し、
// 一時ディレクトリへ展開して checksums.txt（契約 §6: `<sha256>␠␠<相対パス>` 形式）で全ファイルを
// 検証する。カタログには実体（files[]）を一切持たせない設計（tools/publish-free.mjs 側の
// 掲載規律の裏返し）なので、有料素材の取得経路だけこの別ルートを通る。
//
// zip 展開は Windows 標準の tar.exe を優先し、利用可能な展開器へフォールバックする。

import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AssetResolverError } from './errors.mjs';
import { resolveDownloadUrl } from './env.mjs';
import { sha256File } from './hash.mjs';

const NON_PAYLOAD_FILES = new Set(['README.md', 'LICENSE.md', 'checksums.txt']);

/** `/api/store/v1/download/<id>` から zip を destZipPath へダウンロードする（Bearer 認証）。 */
export async function downloadPaidZip(id, credentials, destZipPath, { env = process.env, fetchImpl = fetch } = {}) {
  const url = resolveDownloadUrl(env, credentials, id);
  let res;
  try {
    res = await fetchImpl(url, { headers: { authorization: `Bearer ${credentials.token}` } });
  } catch (error) {
    throw new AssetResolverError(
      `有料素材のダウンロードに失敗しました（ネットワークエラー）: ${id}: ${error instanceof Error ? error.message : String(error)}`,
      'download_failed',
    );
  }
  if (!res.ok || !res.body) {
    throw new AssetResolverError(
      `有料素材のダウンロードに失敗しました: ${id}（HTTP ${res.status ?? '不明'}）`,
      'download_failed',
    );
  }
  await mkdir(path.dirname(destZipPath), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destZipPath));
}

/** All zip consumers share the same platform-independent fallback order. */
export function extractZipWithTools(zipPath, destDir, { spawn = spawnSync, platform = process.platform, env = process.env } = {}) {
  const attempts = [
    [platform === 'win32' ? 'tar.exe' : 'tar', ['-xf', zipPath, '-C', destDir]],
    ['unzip', ['-q', '-o', zipPath, '-d', destDir]],
    [platform === 'win32' ? 'powershell.exe' : 'pwsh', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      'Expand-Archive -LiteralPath $env:AKARI_ZIP_PATH -DestinationPath $env:AKARI_ZIP_DEST -Force',
    ]],
  ];
  const failures = [];
  for (const [command, args] of attempts) {
    const result = spawn(command, args, {
      encoding: 'utf8',
      env: { ...env, AKARI_ZIP_PATH: zipPath, AKARI_ZIP_DEST: destDir },
    });
    if (result.status === 0) return;
    if (result.error?.code !== 'ENOENT') {
      failures.push(`${command}: ${String(result.stderr || result.stdout || result.error?.message || `exit ${result.status}`).trim()}`);
    }
  }
  throw new Error(failures.length
    ? `zip の展開に失敗しました: ${failures.join('; ')}`
    : 'zip を展開できる道具が見つからないため失敗しました。Windows 10 以降の tar.exe、unzip、または PowerShell Expand-Archive を利用可能にしてください。');
}

export function extractZip(zipPath, destDir, options = {}) {
  try {
    extractZipWithTools(zipPath, destDir, options);
  } catch (error) {
    throw new AssetResolverError(error.message, 'download_failed');
  }
}

/**
 * 展開済みディレクトリ（`<product_id>-v<version>/` を直下に 1 つだけ持つ想定。契約 §6）を検証する。
 * checksums.txt に列挙された全ファイルの sha256 を実測と突合し、1 件でも不一致・欠落があれば
 * fail-closed（例外）。README.md / LICENSE.md / checksums.txt を除く素材ペイロードのファイル名
 * 一覧と、その置き場（packageDir）を返す。
 */
export async function verifyPaidZipContents(extractedRoot, id) {
  const entries = await readdir(extractedRoot, { withFileTypes: true });
  const rootDirs = entries.filter((entry) => entry.isDirectory());
  if (rootDirs.length !== 1) {
    throw new AssetResolverError(
      `zip の構成が想定と違います（契約 §6: <product_id>-v<version>/ 直下の単一ディレクトリを期待）: ${id}`,
      'integrity',
    );
  }
  const packageDir = path.join(extractedRoot, rootDirs[0].name);

  let checksumsRaw;
  try {
    checksumsRaw = await readFile(path.join(packageDir, 'checksums.txt'), 'utf8');
  } catch {
    throw new AssetResolverError(`checksums.txt がありません: ${id}`, 'integrity');
  }

  const expected = [];
  for (const line of checksumsRaw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^([0-9a-f]{64})\s+(.+)$/.exec(trimmed);
    if (!match) {
      throw new AssetResolverError(`checksums.txt の行を解釈できません: ${id}: ${trimmed}`, 'integrity');
    }
    const relPath = match[2];
    // zip-slip 防御: checksums.txt 経由で packageDir の外を参照させない（絶対パス・`..` 拒否）
    if (path.isAbsolute(relPath) || relPath.split(/[\\/]/).includes('..')) {
      throw new AssetResolverError(`checksums.txt に不正なパスがあります: ${id}: ${relPath}`, 'integrity');
    }
    expected.push({ sha256: match[1], relPath });
  }
  if (expected.length === 0) {
    throw new AssetResolverError(`checksums.txt が空です: ${id}`, 'integrity');
  }

  for (const entry of expected) {
    const filePath = path.join(packageDir, entry.relPath);
    let actual;
    try {
      actual = await sha256File(filePath);
    } catch {
      throw new AssetResolverError(`checksums.txt に記載のファイルがありません: ${id}/${entry.relPath}`, 'integrity');
    }
    if (actual !== entry.sha256) {
      throw new AssetResolverError(
        `sha256 が一致しません（改竄または破損の可能性）: ${id}/${entry.relPath}（期待 ${entry.sha256} / 実際 ${actual}）`,
        'integrity',
      );
    }
  }

  const payloadFiles = expected.map((entry) => entry.relPath).filter((relPath) => !NON_PAYLOAD_FILES.has(relPath));
  if (payloadFiles.length === 0) {
    throw new AssetResolverError(`zip に素材本体（fragment.html / meta.json / *.glb 等）がありません: ${id}`, 'integrity');
  }
  return { packageDir, payloadFiles };
}
