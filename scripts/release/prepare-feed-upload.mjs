#!/usr/bin/env node
// feed-plan の結果だけを materialize し、workflow は列挙されたファイルだけ upload する。
import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planFeedFiles } from './feed-plan.mjs';
import { rewriteAppUpdateFeed } from './rewrite-app-update-feed.mjs';

export async function prepareFeedUpload(tag, inputDir, outputDir, existingPrereleasePath = '') {
  const json = await readFile(join(inputDir, 'latest.json'), 'utf8');
  const feed = JSON.parse(json);
  let existing = null;
  if (existingPrereleasePath) existing = JSON.parse(await readFile(existingPrereleasePath, 'utf8')).product;
  const plan = planFeedFiles(tag, existing);
  if (feed.product !== tag.slice(1) || feed.channel !== plan.channel) throw new Error('生成フィードとタグが一致しません');
  const win = rewriteAppUpdateFeed(await readFile(join(inputDir, 'latest.yml'), 'utf8'), tag);
  const mac = rewriteAppUpdateFeed(await readFile(join(inputDir, 'latest-mac.yml'), 'utf8'), tag);
  await mkdir(outputDir, { recursive: true });
  for (const name of plan.files) {
    const content = name.endsWith('.json') ? json : name.endsWith('-mac.yml') ? mac : win;
    await writeFile(join(outputDir, name), content, 'utf8');
  }
  return plan.files;
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  try {
    const [tag, inputDir, outputDir, existing = ''] = process.argv.slice(2);
    if (!tag || !inputDir || !outputDir) throw new Error('tag inputDir outputDir [existingPrereleaseJson] が必要です');
    const files = await prepareFeedUpload(tag, inputDir, outputDir, existing);
    if (files.length) process.stdout.write(files.map(file => join(outputDir, file)).join('\n') + '\n');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
