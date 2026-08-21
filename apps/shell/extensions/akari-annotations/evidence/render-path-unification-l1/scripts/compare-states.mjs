#!/usr/bin/env node
// Compares the before/after state-*.json snapshots run-l1.mjs's capture-only phases (2a/2b, 3a/3b)
// write, and asserts the untouched pip-1 clip's classification (itemKind / CSS className /
// computed background) is identical across the move. See run-l1.mjs's "scenarios 2 & 3" comment
// for why these are captured as two independent real-machine boots instead of one live drag.
//
// Usage: node compare-states.mjs <evidenceDir>

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const [, , evidenceDir] = process.argv;
if (!evidenceDir) {
  throw new Error('usage: compare-states.mjs <evidenceDir>');
}

async function loadState(label) {
  return JSON.parse(await readFile(path.join(evidenceDir, `state-${label}.json`), 'utf8'));
}

function assert(condition, message, data) {
  if (!condition) {
    console.log('FAIL:', message, JSON.stringify(data));
    process.exitCode = 1;
    return false;
  }
  console.log('PASS:', message);
  return true;
}

async function compare(scenarioLabel, beforeLabel, afterLabel) {
  const before = await loadState(beforeLabel);
  const after = await loadState(afterLabel);
  console.log(`\n=== ${scenarioLabel}: ${beforeLabel} -> ${afterLabel} ===`);
  console.log('before tracks:', JSON.stringify(before.tracks));
  console.log('after tracks:', JSON.stringify(after.tracks));

  assert(before.pip.itemKind === 'cut' && after.pip.itemKind === 'cut',
    `${scenarioLabel}: pip-1 itemKind stays 'cut' across the move`,
    { before: before.pip.itemKind, after: after.pip.itemKind });
  assert(before.pip.className === after.pip.className,
    `${scenarioLabel}: pip-1 CSS className unchanged across the move`,
    { before: before.pip.className, after: after.pip.className });
  assert(before.pip.background === after.pip.background,
    `${scenarioLabel}: pip-1 computed background unchanged across the move`,
    { before: before.pip.background, after: after.pip.background });
  assert(before.pip.headerBackground === after.pip.headerBackground,
    `${scenarioLabel}: pip-1 header bar computed background unchanged across the move`,
    { before: before.pip.headerBackground, after: after.pip.headerBackground });
  assert(after.move.itemKind === 'cut',
    `${scenarioLabel}: the moved plain clip renders as a cut clip in its new home too`,
    { after: after.move.itemKind });
}

await compare('scenario2 (feedback-r1.md topology)', '2a', '2b');
await compare('scenario3 (feedback-r2.md topology)', '3a', '3b');

if (process.exitCode === 1) {
  console.log('\nOVERALL: FAIL');
} else {
  console.log('\nOVERALL: PASS');
}
