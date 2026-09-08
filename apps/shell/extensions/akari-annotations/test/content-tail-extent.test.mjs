import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as editStore from '@akari-video/edit-store';
import * as mutations from '../lib/common/edit-v2-mutations.js';

const source = readFileSync(new URL('../lib/browser/akari-annotations-widget.js', import.meta.url), 'utf8');
const rest = source.slice(source.indexOf('    computeContentEndDuration('));
const method = rest.slice(0, rest.indexOf('\n    }') + 6);
// Bind the imported modules by their emitted aliases, without assuming tsc's numbering.
const aliases = [...new Set([...method.matchAll(/\b((?:edit_store|edit_v2_mutations)_\d+)\./g)].map(match => match[1]))];
const Widget = new Function(...aliases, `return class {${method}}`)(
    ...aliases.map(alias => alias.startsWith('edit_store_') ? editStore : mutations)
);

test('timeline extent includes output captions and resolved BGM, while respecting excludes and trims', () => {
    const w = Object.assign(new Widget(), {
        cuts: [{}], segments: [{ tlEnd: 5 }], overlays: [], layers: [], audioSfx: [], audioNarration: [],
        timelineTreeTracks: [{ items: [{ source: { kind: 'captions', exclude: ['excluded'] } }] }],
        captions: [{ id: 'a', timeDomain: 'output', end: 12 }, { id: 'excluded', timeDomain: 'output', end: 100 }],
        audioDurationCache: new Map(), fps: 30
    });
    assert.equal(w.computeContentEndDuration(), 12);
    w.audioBgm = { id: 'bgm', path: 'music' };
    w.audioDurationCache.set('music', 30);
    w.editDocument = {
        version: 2, output: { fps: 30, width: 320, height: 180 }, sources: [],
        tracks: [{ id: 'audio', lane: 'audio', items: [
            { id: 'bgm', role: 'bgm', at: 0, duration: 0, source: { kind: 'media', path: 'music', in: 0 } }
        ] }]
    };
    w.rawV2Item = id => w.editDocument.tracks.flatMap(track => track.items).find(item => item.id === id);
    assert.equal(w.computeContentEndDuration(), 12);
    w.rawV2Item('bgm').duration = 900;
    assert.equal(w.computeContentEndDuration(), 30);
    Object.assign(w.rawV2Item('bgm'), { duration: 0, source: { kind: 'media', path: 'music', in: 5, out: 10 } });
    assert.equal(w.computeContentEndDuration(), 12);
});
