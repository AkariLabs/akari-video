import { captionFor } from './caption_shift_emphasis_shift.mjs';
export function measuredAnchor(cap, word, segments) {
    const words = cap.words ?? [];
    const matches = [];
    for (let i = 0; i < words.length; i++) {
        let text = '';
        for (let j = i; j < words.length; j++) {
            text += words[j].text;
            if (text === word) matches.push({ start: words[i].start, end: words[j].end });
            if (!word.startsWith(text) || text === word) break;
        }
    }
    if (matches.length !== 1) throw new Error('対象語の実測 words 時刻がない、または複数あり一意でない');
    const { start, end } = matches[0];
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start < cap.start || end > cap.end || end <= start) throw new Error('単語時刻が字幕行の区間内でない');
    if (cap.timeDomain !== 'output') return { t_start: start, t_end: end, ...(cap.src ? { src: cap.src } : {}) };
    const cuts = segments.filter(s => start >= s.at && end <= s.end);
    if (cuts.length !== 1) throw new Error('出力秒から source 秒への対応が一意でない');
    const cut = cuts[0], source = cut.source;
    if (!source || source.freeze || cut.raw?.freeze || !Number.isFinite(source.in) || !Number.isFinite(source.out) || source.in < 0 || cut.duration <= 0 || source.out <= source.in) throw new Error('source 秒の受け口を確認できない');
    const rate = (source.out - source.in) / cut.duration;
    return { t_start: source.in + (start - cut.at) * rate, t_end: source.in + (end - cut.at) * rate,
        ...(source.src ? { src: source.src } : {}) };
}
