import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/i18n/locales');
let root = defaultRoot;
let check = false;

const argumentsList = process.argv.slice(2);
for (let index = 0; index < argumentsList.length; index++) {
  const argument = argumentsList[index];
  if (argument === '--check') {
    check = true;
  } else if (argument === '--root' && argumentsList[index + 1] && !argumentsList[index + 1].startsWith('--')) {
    root = resolve(argumentsList[++index]);
  } else {
    throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
}

function catalogFiles(language) {
  return readdirSync(join(root, language), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => entry.name)
    .sort();
}

const lines = ['// 生成物・手で編集しない。', "'use strict';", '', 'module.exports = {'];
for (const language of ['ja', 'en']) {
  lines.push(`  ${language}: {`);
  for (const filename of catalogFiles(language)) {
    lines.push(`    ...require(${JSON.stringify(`./${language}/${filename}`)}),`);
  }
  lines.push('  },');
}
lines.push('};', '');

const output = lines.join('\n');
const destination = join(root, 'index.cjs');
if (check) {
  let actual;
  try { actual = readFileSync(destination, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (actual !== output) {
    console.error(`i18n catalog is out of date: ${destination}. Run npm run gen:i18n-catalog.`);
    process.exitCode = 1;
  }
} else {
  writeFileSync(destination, output);
}
