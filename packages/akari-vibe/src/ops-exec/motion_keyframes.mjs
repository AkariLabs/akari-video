import { targetItem } from '../ops/_knobs.mjs';
import { properties } from '../exec-support/motion_keyframes.mjs';
import { valueAt } from '../exec-support/motion_keyframes.mjs';
import { editStore } from '../edit-store.mjs';
import { writeEdit } from '../ops/_knobs.mjs';
import { secondsToFrames } from '../ops/_knobs.mjs';
import { directions } from '../exec-support/motion_keyframes.mjs';
export default { id: 'motion_keyframes', apply(env, d) {
        const skip = reason => env.log.push(`motion_keyframes → 未適用（${reason}）`);
        try {
            const item = targetItem(env, d.target);
            if (!item) return skip('対象 item がない');
            if (item.keyframes !== undefined && !Array.isArray(item.keyframes)) return skip('参照形式のキーフレームは inline 化が必要');
            const old = item.keyframes ?? [];
            if (d.motion_kind === 'clear') {
                if (!old.length) return skip('動きなし・キーフレームなし');
                // Do not claim a full clear when the public typed API cannot remove a field.
                if (old.some(point => Object.keys(point).some(key => !['t', 'easing', 'transform', 'opacity', 'crop', 'perspective'].includes(key))
                    || Object.keys(point.transform ?? {}).some(key => !['x', 'y', 'scale', 'rotate'].includes(key)))) {
                    return skip('公開 removeKeyframe の対象外プロパティを含む');
                }
                const edit = structuredClone(env.edit);
                for (const point of old) for (const property of properties) {
                    if (valueAt(point, property) !== undefined) editStore.removeKeyframe(edit, item.id, property, point.t);
                }
                if (editStore.locate(edit, item.id).item.keyframes !== undefined) return skip('全キーフレームを除去できない');
                writeEdit(env, edit);
                env.log.push(`motion_keyframes ${item.id} → clear（全キーフレーム解除）`);
                return;
            }
            if (!Object.hasOwn(this.questions().motion_kind.criteria, d.motion_kind)) return skip('動きの型が不明');
            if (editStore.locate(env.edit, item.id).track.lane !== 'visual') return skip('視覚トラック以外の動きは未対応');
            if (item.motion !== undefined || item.animator !== undefined) return skip('motion / animator との合成は未対応');
            const end = item.duration;
            if (!Number.isInteger(end) || end < 1) return skip('長さが整数フレームでない');
            const ramp = Math.min(end, Math.max(1, secondsToFrames(env.edit, 0.6)));
            let property, points;
            const kind = d.motion_kind;
            if (kind === 'zoom_in' || kind === 'zoom_out') {
                property = 'transform.scale';
                const base = item.transform?.scale ?? 1;
                points = [[0, base], [end, base * (kind === 'zoom_in' ? 1.2 : 1 / 1.2)]];
            } else if (kind === 'fade_in' || kind === 'fade_out') {
                property = 'opacity';
                const base = item.opacity ?? 1;
                points = kind === 'fade_in' ? [[0, 0], [ramp, base], [end, base]]
                    : [[0, base], [end - ramp, base], [end, 0]];
            } else {
                if (!Object.hasOwn(directions, d.motion_dir)) return skip('入る側・進む方向が未指定');
                const [axis, sign] = directions[d.motion_dir];
                property = `transform.${axis}`;
                const base = item.transform?.[axis] ?? 0;
                const offset = sign * (kind === 'pan' ? 120 : env.edit.output[axis === 'x' ? 'width' : 'height']);
                points = kind === 'enter' ? [[0, base + offset], [ramp, base], [end, base]]
                    : kind === 'exit' ? [[0, base], [end - ramp, base], [end, base + offset]]
                    : [[0, base], [end, base + offset]];
            }
            if (old.some(point => valueAt(point, property) !== undefined)) return skip(`${property} に既存キーフレームあり・置換は未対応`);
            const edit = structuredClone(env.edit);
            // Full-duration endpoints also overwrite setKeyframe's automatic seed point.
            for (const [t, value] of new Map(points)) {
                editStore.setKeyframe(edit, item.id, property, t, value);
                if (t > 0) editStore.setSegmentEasing(edit, item.id, property, t, 'linear');
            }
            writeEdit(env, edit);
            env.log.push(`motion_keyframes ${item.id} → ${kind} ${property}（item 内 0〜${end}f・linear）`);
        } catch (error) {
            skip(error.message);
        }
    } };
