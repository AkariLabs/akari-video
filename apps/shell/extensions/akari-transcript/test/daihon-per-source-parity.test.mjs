import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildDaihonRows } = require('../lib/common/daihon-row-model.js');
const { parseSilenceSpans, rowGapsWithSilences } = require('../lib/common/daihon-silence.js');

const F = new URL('./fixtures/daihon-cut-range-free/', import.meta.url);
const owner = JSON.parse(readFileSync(new URL('captions-owner.json', F), 'utf8'));
const silRaw = JSON.parse(readFileSync(new URL('silences-owner.json', F), 'utf8'));
const captions = owner.captions.map(c => ({
  id: c.id, start: c.start, end: c.end, text: c.text, speaker: c.speaker ?? null,
  ...(c.src ? { src: c.src } : {}), style: c.style ?? null, edited: c.edited,
  ...(c.words ? { words: c.words.map(({ text, start, end }) => ({ text, start, end })) } : {})
}));
const cut = [
  { kind: 'src', src: 'src-1', cutIndex: 0, in: 0, out: 8.61, outStart: 0, outEnd: 8.61 },
  { kind: 'src', src: 'src-1', cutIndex: 1, in: 11.3, out: 26.16, outStart: 8.61, outEnd: 23.47 }
];
const whole = [{ kind: 'src', src: 'src-1', cutIndex: 0, in: 0, out: 26.16, outStart: 0, outEnd: 26.16 }];
const strip = rows => JSON.stringify(rows.map(({ src, ...rest }) => rest));
const sha1 = value => createHash('sha1').update(value).digest('hex');

test('1 素材の buildDaihonRows は src 追加以外バイト同一', () => {
  const cutRows = buildDaihonRows(captions, cut);
  const wholeRows = buildDaihonRows(captions, whole);
  const plainRows = buildDaihonRows(captions, null);
  assert.equal(sha1(strip(cutRows)), 'e8b9e64386cf35fa0c1259ddaf10172fe9d21b1c');
  assert.equal(sha1(strip(wholeRows)), 'c9e2b073cc4076884905d6941db8f47f81be51b6');
  assert.equal(sha1(strip(plainRows)), 'c9e2b073cc4076884905d6941db8f47f81be51b6');
  assert.equal([...cutRows, ...wholeRows, ...plainRows].every(row => row.src === 'src-1'), true);
});

test('1 素材の rowGapsWithSilences はバイト同一', () => {
  const silences = parseSilenceSpans(silRaw.silences);
  assert.equal(silences.length, 13);
  const detected = '[{"prevId":"c-0003","nextId":"c-0004","start":8.61,"end":11.3,"span":2.69,"source":"silence"},{"prevId":"c-0004","nextId":"c-0005","start":13.99,"end":15.74,"span":1.75,"source":"silence"},{"prevId":"c-0005","nextId":"c-0006","start":18.54,"end":19.31,"span":0.77,"source":"silence"},{"prevId":"c-0006","nextId":"c-0007","start":22.38,"end":23.11,"span":0.73,"source":"silence"},{"prevId":"c-0007","nextId":"c-0008","start":23.76,"end":24.77,"span":1.01,"source":"silence"}]';
  const fallback = '[{"prevId":"c-0003","nextId":"c-0004","start":8.22,"end":8.87,"span":0.6499999999999986,"source":"gap"},{"prevId":"c-0004","nextId":"c-0005","start":14.14,"end":14.45,"span":0.3099999999999987,"source":"gap"}]';
  assert.equal(JSON.stringify(rowGapsWithSilences(buildDaihonRows(captions, cut), silences)), detected);
  assert.equal(JSON.stringify(rowGapsWithSilences(buildDaihonRows(captions, whole), silences)), detected);
  assert.equal(JSON.stringify(rowGapsWithSilences(buildDaihonRows(captions, whole), [])), fallback);
});
