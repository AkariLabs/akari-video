import assert from 'node:assert/strict';
import test from 'node:test';
import { clipLookForCut, sourceEffectsForCut, layerChromaEffects } from '../public/video-fx-source.js';

const clip = { id: 'clip-a', src: 'src-a', adjust: { lut: { lut: 'looks/a.cube', intensity: 0.5 } } };
const cubeTexts = { 'clip-a': 'cube' };

test('video-fx-source clipLookForCut resolves only enabled string LUTs', () => {
  const cases = [
    [[undefined, 0], null],
    [[{}, 0], null],
    [[{ cuts: [{ id: 'clip-a' }], adjustLutCubeTexts: cubeTexts }, 0], null],
    [[{ cuts: [{ ...clip, adjust: { ...clip.adjust, sections: { lut: false } } }], adjustLutCubeTexts: cubeTexts }, 0], null],
    [[{ cuts: [{ ...clip, adjust: { lut: { lut: 42, intensity: 0.5 } } }], adjustLutCubeTexts: cubeTexts }, 0], null],
    [[{ cuts: [clip] }, 0], null],
    [[{ cuts: [clip], adjustLutCubeTexts: { 'clip-a': 123 } }, 0], null],
    [[{ cuts: [{ ...clip, adjust: { lut: { lut: 'looks/a.cube', intensity: NaN } } }], adjustLutCubeTexts: cubeTexts }, 0], { cubeText: 'cube', intensity: 1 }],
    [[{ cuts: [{ ...clip, adjust: { lut: { lut: 'looks/a.cube', intensity: -1 } } }], adjustLutCubeTexts: cubeTexts }, 0], { cubeText: 'cube', intensity: 0 }],
    [[{ cuts: [{ ...clip, adjust: { lut: { lut: 'looks/a.cube', intensity: 2 } } }], adjustLutCubeTexts: cubeTexts }, 0], { cubeText: 'cube', intensity: 1 }],
    [[{ cuts: [clip], adjustLutCubeTexts: cubeTexts }, 0], { cubeText: 'cube', intensity: 0.5 }],
    [[{ cuts: [{ ...clip, adjust: { lut: { lut: 'looks/a.cube' } } }], adjustLutCubeTexts: cubeTexts }, 0], { cubeText: 'cube', intensity: 1 }],
    [[{ cuts: [{ id: 7, adjust: { lut: { lut: 'n.cube', intensity: 0.25 } } }], adjustLutCubeTexts: { 7: 'numeric cube' } }, 0], { cubeText: 'numeric cube', intensity: 0.25 }],
  ];
  for (const [input, expected] of cases) assert.deepStrictEqual(clipLookForCut(...input), expected);
});

test('video-fx-source sourceEffectsForCut prefers clip look and retains source chroma', () => {
  const combined = {
    cuts: [
      { id: 'clip-a', src: 'src-a', adjust: { lut: { lut: 'a.cube', intensity: 0.6 } } },
      { id: 'clip-b', src: 'src-b', adjust: { sections: { lut: false }, lut: { lut: 'b.cube', intensity: 1 } } },
      { id: 'clip-c', src: 'src-c' },
    ],
    adjustLutCubeTexts: { 'clip-a': 'clip cube', 'clip-b': 'disabled cube' },
    videoFx: { look: { cubeText: 'global cube', intensity: 0.4 }, sources: { 'src-a': { color: '#00ff00', similarity: 0.3, blend: 0.1 } } },
  };
  const cases = [
    [[combined, 0], { look: { cubeText: 'clip cube', intensity: 0.6 }, chromaKey: { color: '#00ff00', similarity: 0.3, blend: 0.1 } }],
    [[combined, 0, true], { look: { cubeText: 'clip cube', intensity: 0.6 }, chromaKey: { color: '#00ff00', similarity: 0.3, blend: 0.1 } }],
    [[combined, 0, false], { look: { cubeText: 'global cube', intensity: 0.4 }, chromaKey: { color: '#00ff00', similarity: 0.3, blend: 0.1 } }],
    [[combined, 1], { look: { cubeText: 'global cube', intensity: 0.4 } }],
    [[{ cuts: [{ id: 'clip-a', src: 'src-a' }], videoFx: { look: { cubeText: 'global cube', intensity: 0.4 } } }, 0], { look: { cubeText: 'global cube', intensity: 0.4 } }],
    [[{ cuts: [{ id: 'clip-b', src: 'src-b' }], videoFx: { sources: { 'src-b': { color: '#00ff00', similarity: 0.3, blend: 0.1 } } } }, 0], { chromaKey: { color: '#00ff00', similarity: 0.3, blend: 0.1 } }],
    [[{ cuts: [{ id: 'clip-a', adjust: { lut: { lut: 'a.cube' } } }], adjustLutCubeTexts: { 'clip-a': 'clip cube' } }, 0], { look: { cubeText: 'clip cube', intensity: 1 } }],
    [[{ cuts: [{ id: 'clip-a', src: 'src-a' }] }, 0], {}],
    [[undefined, 0], {}],
  ];
  for (const [input, expected] of cases) assert.deepStrictEqual(sourceEffectsForCut(...input), expected);
});

test('video-fx-source layerChromaEffects copies declared fields and fixes mode', () => {
  const cases = [
    [undefined, null],
    [{}, null],
    [{ chroma_key: { color: '#00ff00', similarity: 0.3, blend: 0.1 } }, { chromaKey: { color: '#00ff00', similarity: 0.3, blend: 0.1, mode: 'layer' } }],
    [{ chroma_key: { color: '#00ff00' } }, { chromaKey: { color: '#00ff00', similarity: undefined, blend: undefined, mode: 'layer' } }],
    [{ chroma_key: { similarity: 0.2, blend: 0 } }, { chromaKey: { color: undefined, similarity: 0.2, blend: 0, mode: 'layer' } }],
    [{ chroma_key: false }, null],
  ];
  for (const [input, expected] of cases) assert.deepStrictEqual(layerChromaEffects(input), expected);
});
