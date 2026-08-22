#!/usr/bin/env node
// Writes the on-disk project fixture for one of the 3 render-path-unification L1 scenarios,
// BEFORE Electron is launched for that phase. Discovered empirically (see README.md "実測メモ"):
// the shell's project-launcher onboarding only auto-attaches the timeline/annotations widget to
// a workspace's project/ subfolder on a FRESH process launch (CLI workspace arg) -- a mid-session
// Page.reload() does NOT re-trigger that auto-attach (Theia's own layout-restore state, not the
// launch-time heuristic, drives what reopens after a reload), so simply overwriting edit.json and
// reloading the same live window -- the pattern evidence/v1-clips and evidence/timeline-tracks
// use for a single fixed fixture -- does not work for swapping between structurally different
// projects here. Each scenario therefore gets its own fresh Electron process.
//
// Usage: node prepare-fixture.mjs <phase:1|2|3> <workspaceDir>

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [, , phaseArg, workspaceDir] = process.argv;
const phase = phaseArg;
const VALID_PHASES = ['1', '2a', '2b', '3a', '3b'];
if (!VALID_PHASES.includes(phase) || !workspaceDir) {
  throw new Error(`usage: prepare-fixture.mjs <phase:${VALID_PHASES.join('|')}> <workspaceDir>`);
}

const projectDir = path.join(workspaceDir, 'project');

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr}`);
  }
}

function makeColorSourceIfMissing(filePath, { color, duration, width = 640, height = 360, fps = 10 }) {
  if (existsSync(filePath)) {
    return;
  }
  ffmpeg([
    '-f', 'lavfi', '-i', `color=c=${color}:s=${width}x${height}:r=${fps}:d=${duration}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${duration}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', filePath
  ]);
}

const edits = {
  // scenario 1: P0's original acceptance scenario -- a single plain V1 clip, about to be dragged
  // to a newly-created empty track. Verified live via real mouse drag (see run-l1.mjs scenario1) --
  // that interaction works correctly, so phase 1 stays a single fixture.
  1: {
    version: 2, output: { width: 640, height: 360, fps: 10 },
    sources: [{ id: 's1', path: 'green.mp4', proxy: null }],
    tracks: [
      { id: 'v-main', lane: 'visual', items: [
        { id: 'clip-1', at: 0, duration: 40, source: { kind: 'media', src: 's1', in: 0, out: 4 } }
      ] }
    ]
  },
  // scenario 2: feedback-r1.md's counter-topology -- one empty track, one track with a
  // transform-only PiP clip, one track with a plain clip about to be dragged onto the empty track.
  //
  // NOTE (see README.md "実測メモ -- ドラッグ UI のバグ"): a REAL mouse drag of this scenario's
  // move-1 clip (segment index 1, i.e. not the timeline's first cut clip) reproducibly throws
  // "クリップ 2 の id を特定できません" from akari-annotations-widget.ts's cutItemId() inside
  // updateDragPreview, uncaught, on EVERY mousemove during the drag (reproduces even for a trivial
  // same-row nudge with no track change at all) -- and the drag never commits. This is a
  // pre-existing widget bug, out of this task's file boundary (packages/edit-store,
  // packages/render-cut, packages/edit-lint) and out of scope to fix here, but it blocks driving
  // this scenario via literal drag-and-drop. 2a/2b instead capture the same BEFORE/AFTER states as
  // two independent fresh real-machine boots, with 2b's topology set directly to exactly what
  // moveItem() (packages the widget's own moveV2Item call resolves to,
  // apps/shell/extensions/akari-annotations/src/common/edit-v2-mutations.ts) deterministically
  // produces for this move (splice the item out of its source track, push it verbatim -- same id/
  // duration/source/transform, only `at` reassigned -- onto the target track's items array). This
  // still verifies the actual thing under test (classification stability of the untouched pip-1
  // clip) against the real running app; it just doesn't exercise the (separately broken) mouse
  // gesture itself.
  '2a': {
    version: 2, output: { width: 640, height: 360, fps: 10 },
    sources: [
      { id: 's1', path: 'green.mp4', proxy: null },
      { id: 's2', path: 'magenta.mp4', proxy: null }
    ],
    tracks: [
      { id: 'v-empty', lane: 'visual', items: [] },
      { id: 'v-pip', lane: 'visual', items: [
        { id: 'pip-1', at: 0, duration: 30, source: { kind: 'media', src: 's2', in: 0, out: 3 },
          transform: { scale: 0.3, x: 100, y: 100 } }
      ] },
      { id: 'v-move', lane: 'visual', items: [
        { id: 'move-1', at: 0, duration: 40, source: { kind: 'media', src: 's1', in: 0, out: 4 } }
      ] }
    ]
  },
  '2b': {
    version: 2, output: { width: 640, height: 360, fps: 10 },
    sources: [
      { id: 's1', path: 'green.mp4', proxy: null },
      { id: 's2', path: 'magenta.mp4', proxy: null }
    ],
    tracks: [
      { id: 'v-empty', lane: 'visual', items: [
        { id: 'move-1', at: 0, duration: 40, source: { kind: 'media', src: 's1', in: 0, out: 4 } }
      ] },
      { id: 'v-pip', lane: 'visual', items: [
        { id: 'pip-1', at: 0, duration: 30, source: { kind: 'media', src: 's2', in: 0, out: 3 },
          transform: { scale: 0.3, x: 100, y: 100 } }
      ] },
      { id: 'v-move', lane: 'visual', items: [] }
    ]
  },
  // scenario 3: feedback-r2.md's counter-topology, same track ids it used in its own repro
  // (v1/v2/v5) -- v1 holds the clip about to be dragged, v2 holds an untouched transform-only PiP,
  // v5 is the (existing, empty) drag target. 3b reproduces feedback-r2.md's exact reported end
  // topology (v1 empty / v2 untouched pip / v5 has the moved clip). Same drag-UI-bug caveat as
  // scenario 2 above applies (moved-1 is also not the timeline's first cut clip).
  '3a': {
    version: 2, output: { width: 640, height: 360, fps: 10 },
    sources: [
      { id: 's1', path: 'blue.mp4', proxy: null },
      { id: 's2', path: 'magenta.mp4', proxy: null }
    ],
    tracks: [
      { id: 'v1', lane: 'visual', items: [
        { id: 'moved-1', at: 0, duration: 40, source: { kind: 'media', src: 's1', in: 0, out: 4 } }
      ] },
      { id: 'v2', lane: 'visual', items: [
        { id: 'pip-1', at: 0, duration: 30, source: { kind: 'media', src: 's2', in: 0, out: 3 },
          transform: { scale: 0.3, x: 100, y: 100 } }
      ] },
      { id: 'v5', lane: 'visual', items: [] }
    ]
  },
  '3b': {
    version: 2, output: { width: 640, height: 360, fps: 10 },
    sources: [
      { id: 's1', path: 'blue.mp4', proxy: null },
      { id: 's2', path: 'magenta.mp4', proxy: null }
    ],
    tracks: [
      { id: 'v1', lane: 'visual', items: [] },
      { id: 'v2', lane: 'visual', items: [
        { id: 'pip-1', at: 0, duration: 30, source: { kind: 'media', src: 's2', in: 0, out: 3 },
          transform: { scale: 0.3, x: 100, y: 100 } }
      ] },
      { id: 'v5', lane: 'visual', items: [
        { id: 'moved-1', at: 0, duration: 40, source: { kind: 'media', src: 's1', in: 0, out: 4 } }
      ] }
    ]
  }
};

await mkdir(projectDir, { recursive: true });
await mkdir(path.join(projectDir, '.akari'), { recursive: true });
await writeFile(path.join(projectDir, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');

makeColorSourceIfMissing(path.join(projectDir, 'green.mp4'), { color: 'green', duration: 4 });
makeColorSourceIfMissing(path.join(projectDir, 'magenta.mp4'), { color: 'magenta', duration: 3 });
makeColorSourceIfMissing(path.join(projectDir, 'blue.mp4'), { color: 'blue', duration: 4 });

await writeFile(path.join(projectDir, 'edit.json'), `${JSON.stringify(edits[phase], null, 2)}\n`);
console.log(`prepared phase ${phase} fixture at ${path.join(projectDir, 'edit.json')}`);
