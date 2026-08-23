import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  findUnsupportedDeclaredTrackTransitions,
  unsupportedTrackTransitionTarget,
  usesDefaultCompatibilityTrackOrder
} = require('../lib/index.js');

const cuts = [
  { track: 0, transition_out: { type: 'dissolve', duration: 0.5 } },
  { track: 0 }
];
const defaultTracks = [
  { kind: 'cuts', ref: 0 },
  { kind: 'layers', ref: 0 },
  { kind: 'overlays', ref: 0 }
];
const reorderedTracks = [
  { kind: 'cuts', ref: 0 },
  { kind: 'overlays', ref: 0 },
  { kind: 'layers', ref: 0 }
];

test('既定トラック順では transition_out 宣言を許可する', () => {
  assert.equal(usesDefaultCompatibilityTrackOrder(defaultTracks), true);
  assert.equal(unsupportedTrackTransitionTarget(cuts, defaultTracks, 0), undefined);
  assert.deepEqual(findUnsupportedDeclaredTrackTransitions(cuts, defaultTracks), []);
});

test('既定順でも PiP で cuts track が複数なら transition_out を拒否する', () => {
  const pipTracks = [
    { kind: 'cuts', ref: 0 },
    { kind: 'cuts', ref: 1 },
    { kind: 'layers', ref: 0 }
  ];
  assert.equal(usesDefaultCompatibilityTrackOrder(pipTracks), true);
  assert.equal(unsupportedTrackTransitionTarget(cuts, pipTracks, 0), 0);
});

test('並べ替え済み gap-aware 経路では後続 cut への transition_out を宣言前に拒否できる', () => {
  assert.equal(usesDefaultCompatibilityTrackOrder(reorderedTracks), false);
  assert.equal(unsupportedTrackTransitionTarget(cuts, reorderedTracks, 0), 0);
  assert.deepEqual(findUnsupportedDeclaredTrackTransitions(cuts, reorderedTracks), [
    { cutIndex: 0, trackRef: 0 }
  ]);
});

test('トラック末尾の cut は遷移先が無いため gap-aware 経路でも対象外', () => {
  assert.equal(unsupportedTrackTransitionTarget(cuts, reorderedTracks, 1), undefined);
});

test('宣言前 cut も同じ構造条件で検出し、既存宣言一覧だけは空になる', () => {
  const undeclared = [{ track: 0 }, { track: 0 }];
  assert.equal(unsupportedTrackTransitionTarget(undeclared, reorderedTracks, 0), 0);
  assert.deepEqual(findUnsupportedDeclaredTrackTransitions(undeclared, reorderedTracks), []);
});
