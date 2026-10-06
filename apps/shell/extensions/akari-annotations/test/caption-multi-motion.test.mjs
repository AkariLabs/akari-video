import assert from 'node:assert/strict';
import test from 'node:test';
import { commonCaptionAnimation, captionMotionDelta, applyCaptionMotionDelta,
    withCaptionMultiTargets, captionMultiTargets } from '../lib/browser/inspector/caption-multi-targets.js';
import { replaceMyStylePartsInSource } from '../lib/browser/my-style-look.js';

const caption = (id, animation) => ({ kind: 'caption', id, effectiveTextStyle: { animation } });

test('共通の動きだけをパネルに渡し、登場の変更は各 cue の退場を残す', () => {
    const snapshots = [
        caption('spoken', { out: { id: 'fade-in-out' }, loop: { id: 'float', durationSec: 3 } }),
        caption('placed', { out: { id: 'slide-left' }, loop: { id: 'float', durationSec: 3 } })
    ];
    const common = commonCaptionAnimation(snapshots);
    assert.deepEqual(common, { loop: { id: 'float', durationSec: 3 } });
    const request = withCaptionMultiTargets({ kind: 'caption-style-my-style', id: 'spoken',
        value: { parts: [{ kind: 'motion', animation: {
            in: { id: 'fade-in-out' }, loop: { id: 'float', duration_sec: 3 }
        } }] } }, captionMultiTargets(snapshots), common);
    const delta = request.value.multi_motion_delta;
    assert.deepEqual(delta, { set: { in: { id: 'fade-in-out' } }, remove: [] });
    const before = JSON.stringify({ captions: [
        { id: 'spoken', text_style: { animation: { out: { id: 'fade-in-out' }, loop: { id: 'float', duration_sec: 3 } } } },
        { id: 'placed', time_domain: 'output', text_style: { animation: {
            out: { id: 'slide-left' }, loop: { id: 'float', duration_sec: 3 }
        } } }
    ] });
    const after = replaceMyStylePartsInSource(before, ['spoken', 'placed'], request.value.parts,
        { motionDelta: delta });
    assert.deepEqual(JSON.parse(after).captions.map(row => row.text_style.animation), [
        { out: { id: 'fade-in-out' }, loop: { id: 'float', duration_sec: 3 }, in: { id: 'fade-in-out' } },
        { out: { id: 'slide-left' }, loop: { id: 'float', duration_sec: 3 }, in: { id: 'fade-in-out' } }
    ]);
    assert.equal(JSON.parse(before).captions[0].text_style.animation.in, undefined);
});

test('共通スロットの削除と組の複数スロット設定を差分にする', () => {
    const common = { in: { id: 'pop' }, loop: { id: 'float' } };
    const delta = captionMotionDelta(common, { in: { id: 'fade-in-out' }, out: { id: 'slide-up' } });
    assert.deepEqual(delta, { set: { in: { id: 'fade-in-out' }, out: { id: 'slide-up' } }, remove: ['loop'] });
    assert.deepEqual(applyCaptionMotionDelta({ in: { id: 'pop' }, loop: { id: 'float' },
        out: { id: 'own-out' } }, delta), {
        in: { id: 'fade-in-out' }, out: { id: 'slide-up' }
    });
});
