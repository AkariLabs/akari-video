#!/usr/bin/env node
import fs from 'node:fs';
import { validateFrameScene } from '../../frame-scene/src/schema.mjs';

const argument = process.argv[2];
if (argument === '--help' || argument === '-h') {
  console.log('使い方: node packages/schemas/bin/validate-frame-scene.mjs <scene.json> [--strict]');
  process.exit(0);
}
if (!argument || process.argv.length > 4 || (process.argv[3] && process.argv[3] !== '--strict')) {
  console.error('使い方: node packages/schemas/bin/validate-frame-scene.mjs <scene.json> [--strict]');
  process.exit(2);
}
try {
  const raw = fs.readFileSync(argument);
  const result = validateFrameScene(JSON.parse(raw.toString('utf8')), { strict: process.argv[3] === '--strict', fileBytes: raw.byteLength });
  for (const item of result.errors) console.error(`ERROR ${item.code} ${item.path}: ${item.message}`);
  for (const item of result.warnings) console.warn(`WARN ${item.code} ${item.path}: ${item.message}`);
  console.log(`${result.ok ? 'OK' : 'NG'}: ${argument}`);
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error(`NG: ${argument}: ${error.message}`);
  process.exit(1);
}
