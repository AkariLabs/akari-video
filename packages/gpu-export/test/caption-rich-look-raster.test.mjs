import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildOsrPage } from '../../osr-export/src/page-builder.mjs';
import { buildGpuPage } from '../src/page-builder.mjs';

const edit = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [], overlays: [] };
const looks = [
  ['stroke_inner', { color: '#ff5a00', width_px: 3 },
    '1c36f56fd6306858004335025efe0f4ad96c55607af4d1adfbe712010a54ee82'],
  ['fill_gradient', { colors: ['#fb923c', '#8b5cf6'], angle_deg: 90 },
    '24535674340127c297bde38554e69c9d302e18791f4dafa5d0e3dbeada43245e'],
  ['extrude', { depth_px: 5, color: '#a16207', angle_deg: 135 },
    '8cff6513791a6a35dce801dbb4e4132b70cbf3f41b7cafc29a1609a1dbd31dd4'],
];

test('GPU plate raster and reference sheet use identical rich-look HTML and CSS declarations', () => {
  for (const [name, value, digest] of looks) {
    const captions = [{ id: 'c-0001', start: 0, end: 1, text: '字幕', text_style: { [name]: value } }];
    const common = { edit, captions, projectRoot: process.cwd(), duration: 1,
      frameEngineBundle: '', pageRuntime: '' };
    const gpu = buildGpuPage({ ...common, slotParamsRuntime: '', itemKeyframesRuntime: '' })
      .spriteManifest.captions[0];
    const osr = buildOsrPage(common).overlaySheetHtml;
    assert.ok(osr.includes(gpu.html), `${name}: caption HTML`);
    for (const [property, css] of Object.entries(gpu.vars)) {
      assert.ok(osr.includes(`${property}:${css}`), `${name}: ${property}`);
    }
    assert.equal(createHash('sha256').update(JSON.stringify(gpu.vars)).digest('hex'), digest, name);
    if (name === 'stroke_inner') {
      assert.equal(gpu.vars['--caption-stroke'], '0 transparent');
      assert.match(gpu.vars['--caption-text-shadow'], /^3px 0px 0 #ff5a00/u);
    }
    if (name === 'fill_gradient') {
      assert.equal(gpu.vars['--caption-fill-gradient'], 'linear-gradient(90deg, #fb923c, #8b5cf6)');
      assert.equal(gpu.vars['--caption-fill-clip'], 'text');
    }
    if (name === 'extrude') {
      assert.match(gpu.vars['--caption-text-shadow'], /3\.535534px 3\.535534px 0 #a16207$/u);
    }
  }
});
