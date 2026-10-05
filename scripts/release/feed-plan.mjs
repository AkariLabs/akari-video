#!/usr/bin/env node
// updates Release の書換対象を決める。latest.* は旧クライアントも読むため安定版専用。
// prerelease.* はベータと、それ以降の安定版のうち最新のものを保持する。
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseTag } from './check-release-versions.mjs';

export function compareReleaseVersions(a, b) {
  const parse = value => {
    const match = String(value).match(/^(\d+)\.(\d+)\.(\d+)(?:-beta\.([1-9]\d*))?$/);
    return match && match.slice(1).map(part => part === undefined ? null : BigInt(part));
  };
  const left = parse(a), right = parse(b);
  if (!left || !right) throw new Error(`版が不正です: ${a}, ${b}`);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  if (left[3] === null || right[3] === null) return left[3] === right[3] ? 0 : left[3] === null ? 1 : -1;
  return left[3] === right[3] ? 0 : left[3] < right[3] ? -1 : 1;
}

export function channelForTag(tag) {
  if (!parseTag(tag)) throw new Error(`タグが不正です: ${tag}`);
  return tag.includes('-beta.') ? 'prerelease' : 'stable';
}

export function assertReleaseFlags(tag, { isPrerelease, stableInput } = {}) {
  const channel = channelForTag(tag);
  if (typeof isPrerelease === 'boolean' && isPrerelease !== (channel === 'prerelease')) {
    throw new Error(`Release の isPrerelease とタグ ${tag} が一致しません`);
  }
  // 既存の stable 入力は stable タグでは任意、beta タグで true は矛盾。
  if (stableInput === true && channel !== 'stable') {
    throw new Error(`stable: true とタグ ${tag} が一致しません`);
  }
  return channel;
}

export function planFeedFiles(tag, existingPrerelease = null) {
  const channel = channelForTag(tag);
  if (existingPrerelease !== null && !parseTag(`v${existingPrerelease}`)) {
    throw new Error(`既存 prerelease.json の版が不正です: ${existingPrerelease}`);
  }
  const updatePrerelease = existingPrerelease === null
    || compareReleaseVersions(tag.slice(1), existingPrerelease) >= 0;
  return {
    channel,
    updatePrerelease,
    files: [
      ...(channel === 'stable' ? ['latest.json', 'latest.yml', 'latest-mac.yml', 'stable.yml', 'stable-mac.yml'] : []),
      ...(updatePrerelease ? ['prerelease.json', 'prerelease.yml', 'prerelease-mac.yml'] : [])
    ]
  };
}

async function main() {
  const [tag, existingPath = ''] = process.argv.slice(2);
  let version = null;
  if (existingPath) {
    const feed = JSON.parse(await readFile(existingPath, 'utf8'));
    version = feed.product;
  }
  const plan = planFeedFiles(tag, version);
  process.stdout.write(`${JSON.stringify(plan)}\n`);
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  try { await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
