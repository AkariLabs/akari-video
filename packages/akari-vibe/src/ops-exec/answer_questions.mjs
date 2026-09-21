import { view } from '../v2/model.mjs';
import { itemForKey } from '../v2/model.mjs';
import { editStore } from '../edit-store.mjs';
export default { id: 'answer_questions', apply(env, d) {
        delete env.answer;
        const unavailable = reason => env.log.push(`answer_questions → 未適用（${reason}）`);
        const kind = d.answer_questions_kind;
        const { segments, internal, locations } = view(env.edit);
        const fps = env.edit.output.fps;
        const answer = (value, unit, text, extra = {}) => {
            env.answer = { kind, value, unit, text, ...extra };
            env.log.push(`answer_questions → ${text}`);
        };
        const seconds = item => item.duration / fps;
        if (kind === 'cut_duration') {
            const n = d.target?.match(/^cut_(\d+)$/)?.[1];
            const cut = n ? segments.find(s => s.index + 1 === Number(n))
                : d.target && d.target !== 'none' ? segments.find(s => s.raw === itemForKey(env.edit, d.target))
                    : segments.find(s => env.playheadT >= s.at && env.playheadT < s.end);
            if (!cut) return unavailable('対象カットがない');
            return answer(seconds(cut.raw), '秒', `カット${cut.index + 1}は${seconds(cut.raw)}秒`, { itemId: cut.itemId });
        }
        if (kind === 'total_duration') {
            const { seconds: value } = editStore.timelineDurationSeconds(internal);
            return answer(value, '秒', `動画全体は${value}秒（${Math.floor(value / 60)}分${value % 60}秒）`);
        }
        if (kind === 'telop_count') {
            const value = locations.filter(({ item }) => item.source.kind === 'telop').length;
            return answer(value, '個', `テロップは全体で${value}個`);
        }
        if (kind === 'what_said') {
            const matches = (env.context?.transcript ?? []).filter(s => s.start <= env.playheadT && env.playheadT < s.end);
            if (matches.length !== 1 || !matches[0].text) return unavailable('現在時刻の文字起こしがない、または複数あり特定できない');
            const segment = matches[0];
            return answer(segment.text, null, segment.text, { segmentId: segment.id });
        }
        if (kind === 'bgm_volume') {
            const bgms = locations.map(({ item }) => item).filter(item => item.role === 'bgm');
            const item = d.target && d.target !== 'none' ? itemForKey(env.edit, d.target) : bgms.length === 1 ? bgms[0] : null;
            if (!item || item.role !== 'bgm') return unavailable('対象BGMがない、または特定できない');
            const value = item.gain_db ?? 0;
            return answer(value, 'dB', `BGMの設定音量は${value}dB`, { itemId: item.id });
        }
        if (kind === 'telop_duration') {
            const item = itemForKey(env.edit, d.target);
            if (!item || item.source.kind !== 'telop') return unavailable('対象テロップがない');
            return answer(seconds(item), '秒', `テロップ${item.id}の表示時間は${seconds(item)}秒`, { itemId: item.id });
        }
        return unavailable('質問の種類が未対応');
    } };
