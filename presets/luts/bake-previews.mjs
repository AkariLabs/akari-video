import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeIndexedWebp } from './webp-lossless.mjs';
import { readLut, renderLutPreview, renderReferenceFrame } from './preview-art.mjs';
import { transitionVocabulary, renderTransition } from '../transitions/preview-art.mjs';
import { contactSheet } from './contact-sheet.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const lutRoot = join(root, 'presets/luts');
const transitionRoot = join(root, 'presets/transitions');

export function bakePreviews() {
  const reference = renderReferenceFrame();
  writeFileSync(join(lutRoot, 'reference-frame.webp'),
    encodeIndexedWebp(reference.width, reference.height, reference.palette, reference.indices));
  const lines = readFileSync(join(lutRoot, 'index.jsonl'), 'utf8').trim().split('\n');
  const luts = lines.map(line => JSON.parse(line));
  const lutArt = [];
  for (const entry of luts) {
    if (!/^[a-z0-9-]+$/u.test(entry.id)) throw new Error(`unsafe LUT id: ${entry.id}`);
    const art = renderLutPreview(readLut(join(lutRoot, entry.id, `${entry.id}.cube`)));
    const preview = `${entry.id}/preview.webp`;
    writeFileSync(join(lutRoot, preview), encodeIndexedWebp(art.width, art.height, art.palette, art.indices));
    entry.preview = preview;
    lutArt.push({ id: entry.id, art });
  }
  writeFileSync(join(lutRoot, 'index.jsonl'), luts.map(entry => JSON.stringify(entry)).join('\n') + '\n');

  const transitions = transitionVocabulary();
  const transitionArt = [];
  for (const entry of transitions) {
    const directory = join(transitionRoot, entry.id);
    mkdirSync(directory, { recursive: true });
    const art = renderTransition(entry.previewKind, [0, .5, 1]);
    const strip = renderTransition(entry.previewKind, [0, .25, .5, .75, 1]);
    writeFileSync(join(directory, 'preview.webp'), encodeIndexedWebp(art.width, art.height, art.palette, art.indices));
    writeFileSync(join(directory, 'preview-strip.webp'), encodeIndexedWebp(strip.width, strip.height, strip.palette, strip.indices));
    transitionArt.push({ id: entry.id, art });
  }
  writeFileSync(join(transitionRoot, 'index.jsonl'), transitions.map(entry => JSON.stringify({
    id: entry.id, name: entry.name, category: entry.category,
    preview: `${entry.id}/preview.webp`, preview_strip: `${entry.id}/preview-strip.webp`,
  })).join('\n') + '\n');
  const evidence = join(root, 'evidence/v1-preset-previews');
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, 'contact-sheet.png'), contactSheet(lutArt, transitionArt));
  return { luts: luts.length, transitions: transitions.length };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const result = bakePreviews();
  process.stdout.write(`Baked ${result.luts} LUTs and ${result.transitions} transitions.\n`);
}
