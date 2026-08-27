import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const generated = resolve(testDirectory, 'golden/.generated');
const resultsPath = resolve(generated, 'gop-tail-seek-results.json');
const htmlPath = resolve(generated, 'gop-tail-seek-chromium.html');
const bundlePath = resolve(generated, 'gop-tail-seek-renderer.js');
const fixtureUrl = pathToFileURL(resolve(generated, 'source.mp4')).toString();
writeFileSync(
  htmlPath,
  readFileSync(resolve(testDirectory, 'gop-tail-seek.html'), 'utf8')
    .replace(/\s*<script src="frame-engine-seek:\/\/app\/renderer\.js"><\/script>/u, ''),
);

let resolveCompletion;
let rejectCompletion;
const completion = new Promise((resolveValue, rejectValue) => {
  resolveCompletion = resolveValue;
  rejectCompletion = rejectValue;
});
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
page.on('console', message => process.stdout.write(`[chromium-seek] ${message.text()}\n`));
page.on('pageerror', error => process.stderr.write(`[chromium-seek:error] ${error.stack ?? error.message}\n`));
await page.exposeFunction('__seekComplete', async result => {
  writeFileSync(resultsPath, `${JSON.stringify(result, null, 2)}\n`);
  resolveCompletion(result);
  return true;
});
await page.exposeFunction('__seekFail', async message => {
  const result = { pass: false, error: String(message) };
  writeFileSync(resultsPath, `${JSON.stringify(result, null, 2)}\n`);
  rejectCompletion(new Error(result.error));
  return true;
});
await page.addInitScript(sourceUrl => {
  window.seekHarness = {
    fixtureUrl: sourceUrl,
    complete: result => window.__seekComplete(result),
    fail: message => window.__seekFail(message),
  };
}, fixtureUrl);

try {
  await page.goto(pathToFileURL(htmlPath).toString());
  await page.addScriptTag({ path: bundlePath });
  await Promise.race([
    completion,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Chromium seek harness timed out')), 300_000)),
  ]);
} finally {
  await browser.close();
}
