import { targetItem } from '../ops/_knobs.mjs';
import { declarations } from '../v2/declared-knobs.mjs';
import { patchItem } from '../ops/_knobs.mjs';
export function options(k) {
    if (Array.isArray(k.options)) return k.options.map(o => typeof o === 'object' && o !== null
        ? { value: String(o.value), label: String(o.label ?? o.value) } : { value: String(o), label: String(o) });
    if (k.options && typeof k.options === 'object') return Object.entries(k.options).map(([value, label]) => ({ value, label: String(label) }));
    const list = k.label.match(/[（(]([^）)]*\/[^）)]*)[）)]/)?.[1];
    return (list?.split('/') ?? []).flatMap(part => {
        const value = part.trim().match(/^([a-zA-Z][\w-]*)\b/)?.[1];
        return value ? [{ value, label: part.trim() }] : [];
    });
}
export const readings = { ろっぴゃく:'六百', はっぴゃく:'八百', さんびゃく:'三百', さんぜん:'三千', はっせん:'八千',
    きゅう:'九', じゅう:'十', ひゃく:'百', れい:'零', ゼロ:'零', いち:'一', に:'二', さん:'三', よん:'四',
    ご:'五', ろく:'六', なな:'七', はち:'八', せん:'千', まん:'万', てん:'点' };
export const kanaPattern = new RegExp(`(?:${Object.keys(readings).sort((a,b)=>b.length-a.length).join('|')})+(?=\\s|[、。]|$|に(?:して|する|変)|ピクセル|パーセント)`, 'g');
export function japaneseNumber(s) {
    const digits = '〇一二三四五六七八九';
    const digit = c => c === '零' ? 0 : /\d/.test(c) ? Number(c) : digits.indexOf(c);
    const [whole, fraction] = s.split(/[点.]/);
    let section = 0, total = 0, pending = '';
    for (const c of whole) {
        const unit = { 十:10, 百:100, 千:1000, 万:10000 }[c];
        if (!unit) pending += digit(c);
        else if (unit === 10000) { total += (section + Number(pending || (section ? 0 : 1))) * unit; section = 0; pending = ''; }
        else { section += Number(pending || 1) * unit; pending = ''; }
    }
    return total + section + Number(pending || 0) + (fraction ? Number('0.' + [...fraction].map(digit).join('')) : 0);
}
export function numbers(text = '') {
    let normalized = text.normalize('NFKC');
    normalized = normalized.replace(kanaPattern, (s, index) => {
        // Avoid treating particles such as に and ご as standalone numbers.
        if (s.length === 1 && !/^(?:に(?:して|する|変)|ピクセル|パーセント)/.test(normalized.slice(index + s.length).trimStart())) return s;
        return s.replace(new RegExp(Object.keys(readings).sort((a,b)=>b.length-a.length).join('|'), 'g'), x => readings[x]);
    });
    return [...new Set([...normalized.matchAll(/(?:マイナス\s*|[-−])?[0-9〇零一二三四五六七八九十百千万]+(?:[.点][0-9〇零一二三四五六七八九]+)?/g)]
        .map(m => { const negative = /^(マイナス|[-−])/.test(m[0]); return (negative ? -1 : 1) * japaneseNumber(m[0].replace(/^(マイナス\s*|[-−])/, '')); }).filter(Number.isFinite))];
}
export const numeric = k => ['slider', 'number', 'range'].includes(k.type);
