import assert from 'node:assert/strict';
import test from 'node:test';
import { appendAdoptedRegion, buildAdoptedPhotoRegion, photoAdoptionPolarity, photoPanelPlacement, regionDisplayName, togglePhotoCandidateSelection } from '../lib/browser/inspector/photo-panel-state.js';

test('adoption keeps the panel open on the new named region', () => {
    const previous = [{ id: 'region-1', name: '人物 1' }];
    const added = appendAdoptedRegion(previous, { id: 'background-2', name: '背景' });
    assert.equal(added.selectedIndex, 1);
    assert.deepEqual(added.regions.map(regionDisplayName), ['人物 1', '背景']);
    assert.equal(previous.length, 1);
});

test('choosing person one replaces the automatic union and pressing again removes it', () => {
    const all = 'vision-people--all', person = 'vision-people--person-1';
    const one = togglePhotoCandidateSelection(new Set([all]), person);
    assert.deepEqual([...one], [person]);
    assert.deepEqual([...togglePhotoCandidateSelection(one, person)], []);
});

test('inspector panel fits within the right widget without covering the preview', () => {
    const placement = photoPanelPlacement({ width: 1440, height: 900 }, { left: 1090, top: 24, width: 350 });
    assert.deepEqual(placement, { left: 1096, top: 68, width: 338 });
    assert.ok(placement.left >= 1090);
    assert.ok(placement.left + placement.width <= 1440);
});

test('photo adoption produces one inversion and background patch affects only the background pixel', async () => {
    const { applyPhotoRegions } = await import('../../../../../packages/frame-engine/dist/adjust/photo-regions.js');
    const { bakeItemAdjustLut } = await import('../../../../../packages/frame-engine/dist/adjust/bake.js');
    const hash = 'a'.repeat(64), maskRef = `mask-${hash}`;
    const foreground = Uint8Array.from([255, 0]);
    const person = buildAdoptedPhotoRegion(hash, maskRef, [], false, '人物 1');
    const background = buildAdoptedPhotoRegion(hash, maskRef, [person], true, '背景');
    assert.deepEqual(photoAdoptionPolarity('region', true), { compositeInvert: false, regionInvert: true });
    assert.deepEqual(photoAdoptionPolarity('cutout', true), { compositeInvert: true, regionInvert: false });
    assert.equal(person.invert, undefined);
    assert.equal(background.invert, true);
    assert.equal(background.maskRef, person.maskRef);
    const image = Uint8ClampedArray.from([80, 40, 20, 255, 30, 100, 180, 255]);
    const result = applyPhotoRegions(image, 2, 1, undefined, [
        { mask: foreground, invert: Boolean(person.invert), adjustLut: bakeItemAdjustLut({ basic: { exposure: 1.5 } }) },
        { mask: foreground, invert: Boolean(background.invert), adjustLut: bakeItemAdjustLut({ basic: { saturation: -1 } }) }
    ]);
    assert.ok(result[0] > image[0]);
    assert.notEqual(result[0], result[1]);
    assert.equal(result[4], result[5]);
    assert.equal(result[5], result[6]);
});
