#!/usr/bin/env node
// 本体 Release の updater manifest を updates 固定 Release 用へ変換する。
// バイナリは本体 Release に残すため、files[].url と path のみ絶対 URL にする。

import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseTag } from './check-release-versions.mjs';

const RELEASE_DOWNLOAD_BASE = 'https://github.com/AkariLabs/akari-video/releases/download/';

export function rewriteAppUpdateFeed(source, tag) {
  if (typeof source !== 'string' || !parseTag(tag)) {
    throw new Error('更新メタデータまたはタグが不正です');
  }
  const version = source.match(/^version:\s*['"]?([^'"\s]+)['"]?\s*$/m)?.[1];
  if (version !== tag.slice(1)) {
    throw new Error(`更新メタデータの版 ${version ?? '(なし)'} がタグ ${tag} と一致しません`);
  }
  const base = `${RELEASE_DOWNLOAD_BASE}${encodeURIComponent(tag)}/`;
  const fileNames = [];
  let pathName;
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const rewritten = lines.map(line => {
    const file = line.match(/^(\s+- url:\s*)(['"]?)([^'"\s]+)\2(\s*)$/);
    const path = line.match(/^(path:\s*)(['"]?)([^'"\s]+)\2(\s*)$/);
    const match = file ?? path;
    if (!match) { return line; }
    const name = match[3];
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes('..')) {
      throw new Error(`更新ファイル名が不正です: ${name}`);
    }
    if (file) { fileNames.push(name); } else { pathName = name; }
    return `${match[1]}'${base}${encodeURIComponent(name)}'${match[4]}`;
  });
  if (fileNames.length === 0 || !pathName || !fileNames.includes(pathName)) {
    throw new Error('files[].url と path が一致する更新メタデータが必要です');
  }
  return rewritten.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    throw new Error('使い方: node rewrite-app-update-feed.mjs <tag> <入力 yml> <出力 yml>');
  }
  const [tag, inputPath, outputPath] = args;
  await writeFile(outputPath, rewriteAppUpdateFeed(await readFile(inputPath, 'utf8'), tag), 'utf8');
}

function isMainModule() {
  if (!process.argv[1]) { return false; }
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); }
  catch { return false; }
}

if (isMainModule()) {
  try { await main(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
