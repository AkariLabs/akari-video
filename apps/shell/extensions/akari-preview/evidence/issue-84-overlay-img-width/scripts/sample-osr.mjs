import { readFile } from 'node:fs/promises';
import { decodePng } from './png-lib.mjs';
import { SAMPLE_POINTS } from './measure.mjs';
const png = decodePng(await readFile(process.argv[2]));
console.log(JSON.stringify({ size: [png.width, png.height], pixels: Object.fromEntries(Object.entries(SAMPLE_POINTS).map(([k, [x, y]]) => [k, png.pixel(x, y)])) }));
