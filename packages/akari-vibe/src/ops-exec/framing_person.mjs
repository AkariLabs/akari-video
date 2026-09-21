import { targetItem } from '../ops/_knobs.mjs';
import { view } from '../v2/model.mjs';
import { centerAnchor } from '../exec-support/framing_person.mjs';
import { clamp } from '../exec-support/framing_person.mjs';
import { PERSON_HEIGHT } from '../exec-support/framing_person.mjs';
import { MAX_SCALE } from '../exec-support/framing_person.mjs';
import { knobs } from '../ops/_knobs.mjs';
export default { id: 'framing_person', apply(env, d) {
        if (d.framingPersonRule?.length) env.log.push(`framing_person rules: ${JSON.stringify(d.framingPersonRule)}`);
        const skip = reason => env.log.push(`framing_person ${d.target ?? 'none'} → 未適用（${reason}）`);
        if (!/^person_.+$/u.test(d.target ?? '')) return skip('人物キーが必要');
        const item = targetItem(env, d.target);
        if (!item) return skip('再生ヘッドを含む本編カットがない');
        const { segments, locations } = view(env.edit);
        const segment = segments.find(s => s.itemId === item.id);
        if (!segment || item.source.kind !== 'media') return skip('本編の media item ではない');
        const transform = item.transform ?? {};
        // The clamp below covers an unrotated, full-frame rectangle only.
        if ((transform.rotate ?? 0) !== 0 || item.crop || item.perspective || item.framing || item.freeze || item.keyframes?.length) {
            return skip('回転・クロップ・透視・framing・静止・キーフレーム付きの構図は未対応');
        }
        const location = locations.find(l => l.item.id === item.id);
        if (location?.parent) return skip('親 item の座標変換は未対応');
        const { width: W, height: H } = env.edit.output;
        const oldScale = transform.scale ?? 1;
        if (![W, H, oldScale].every(v => Number.isFinite(v) && v > 0)) return skip('出力寸法または倍率が不正');
        const { in: start, out: end } = item.source;
        if (![start, end].every(Number.isFinite) || end <= start || segment.end <= segment.at) return skip('素材区間または出力区間が不正');
        // Output seconds -> source seconds; duration already includes playback speed.
        const sourceT = start + (env.playheadT - segment.at) / (segment.end - segment.at) * (end - start);
        const mainSources = new Set(segments.map(s => s.raw.source.src));
        const people = (env.context.vision ?? []).filter(p => p.id === d.target
            && Array.isArray(p.srcRange) && p.srcRange.length === 2 && p.srcRange.every(Number.isFinite)
            && sourceT >= p.srcRange[0] && sourceT < p.srcRange[1]
            && (p.src != null ? p.src === item.source.src : mainSources.size === 1));
        if (people.length !== 1) return skip(people.length ? '同時刻の人物 box が複数あり曖昧' : '人物が素材時刻の srcRange 外、または素材を特定できない');
        const box = people[0].box;
        if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return skip('人物 box が不正');
        const [bx, by, bw, bh] = box;
        if (bx < 0 || by < 0 || bw <= 0 || bh <= 0 || bx + bw > 1 || by + bh > 1) return skip('人物 box が正規化フレーム外');
        const anchor = d.framingPersonAnchor ?? centerAnchor(env.ctx?.text);
        const cx = bx + bw / 2, cy = by + bh * (anchor === 'face' ? 0.15 : 0.5);
        const inward = d.direction === 'bigger', outward = d.direction === 'smaller';
        if (!inward && !outward && !anchor) return skip('寄る・引く・中央合わせの指定がない');

        // Centering without exposed frame edges requires this much magnification.
        const centerScale = 1 / (2 * Math.min(cx, 1 - cx, cy, 1 - cy));
        const scale = outward
            ? Math.max(1, oldScale / 1.25)
            : clamp(Math.max(oldScale, inward ? PERSON_HEIGHT / bh : 1, centerScale), 1, MAX_SCALE);
        // Source-frame center -> output-frame center, in output pixels (not normalized units).
        const wantedX = (0.5 - cx) * W * scale, wantedY = (0.5 - cy) * H * scale;
        const limitX = W * (scale - 1) / 2, limitY = H * (scale - 1) / 2;
        const x = clamp(wantedX, -limitX, limitX) || 0, y = clamp(wantedY, -limitY, limitY) || 0;
        if (knobs(env, item, { transform: { x, y, scale } })) {
            const clipped = Math.abs(x - wantedX) > 1e-7 || Math.abs(y - wantedY) > 1e-7;
            env.log.push(`framing_person ${d.target} → ${item.id} ${outward ? '引く' : anchor === 'face' ? '顔を中央' : '人物へ寄せる'} x=${x.toFixed(2)}px y=${y.toFixed(2)}px scale=${scale.toFixed(4)}${clipped ? '（画面外クランプ・完全な中央合わせは不可）' : ''}`);
        }
    } };
