import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Pin both the bytes and the repository revision. Run this only when deliberately refreshing the catalog.
const commit = '7085eb89a950e85db5b166b7a58d414544b4140c';
const families = {
  'biz-udgothic': ['bizudgothic', 'BIZ UDGothic'],
  'dela-gothic-one': ['delagothicone', 'Dela Gothic One'],
  dotgothic16: ['dotgothic16', 'DotGothic16'],
  'klee-one': ['kleeone', 'Klee One'],
  'mplus-1p': ['mplus1p', 'M PLUS 1p'],
  'mplus-rounded-1c': ['mplusrounded1c', 'M PLUS Rounded 1c'],
  'noto-sans-jp': ['notosansjp', 'Noto Sans JP'],
  'noto-serif-jp': ['notoserifjp', 'Noto Serif JP'],
  'reggae-one': ['reggaeone', 'Reggae One'],
  'rocknroll-one': ['rocknrollone', 'RocknRoll One'],
  'shippori-mincho': ['shipporimincho', 'Shippori Mincho'],
  'zen-kaku-gothic-new': ['zenkakugothicnew', 'Zen Kaku Gothic New'],
  'zen-maru-gothic': ['zenmarugothic', 'Zen Maru Gothic']
};

async function bytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
const digest = data => createHash('sha256').update(data).digest('hex');
const entries = {};
for (const [id, [directory, family]] of Object.entries(families)) {
  const root = `https://raw.githubusercontent.com/google/fonts/${commit}/ofl/${directory}/`;
  const metadata = (await bytes(`${root}METADATA.pb`)).toString('utf8');
  const filenames = [...metadata.matchAll(/filename:\s*"([^"/]+\.(?:ttf|otf))"/g)].map(match => match[1]);
  const file = filenames.find(name => /\[wght\]/i.test(name))
    ?? filenames.find(name => /regular/i.test(name)) ?? filenames[0];
  if (!file) throw new Error(`${id}: font file not found`);
  const font = await bytes(`${root}${encodeURIComponent(file)}`);
  let license;
  let licenseUrl;
  try {
    license = await bytes(`${root}OFL.txt`);
    licenseUrl = `${root}OFL.txt`;
  } catch (error) {
    if (id !== 'mplus-rounded-1c') throw error;
    // This Google Fonts directory records license: OFL in METADATA.pb but omits OFL.txt.
    license = await readFile(new URL('../assets/font/mplus-rounded-1c/OFL.txt', import.meta.url));
  }
  if (!license.toString('utf8').includes('SIL OPEN FONT LICENSE')) throw new Error(`${id}: invalid OFL`);
  entries[id] = {
    family, file, bytes: font.length, sha256: digest(font), url: `${root}${encodeURIComponent(file)}`,
    ofl: { file: 'OFL.txt', bytes: license.length, sha256: digest(license),
      ...(licenseUrl ? { url: licenseUrl } : { text: license.toString('utf8') }) }
  };
}
const output = resolve(fileURLToPath(new URL('../catalog/font/download-manifest.json', import.meta.url)));
await writeFile(output, `${JSON.stringify({ commit, fonts: entries }, null, 2)}\n`);
