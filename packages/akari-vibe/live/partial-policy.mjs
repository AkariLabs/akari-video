// 途中経過を判断へ送る前の安価な方針。判断カタログや質問には依存しない。
export const P2_FIXED_WORDS = Object.freeze([
    '秒', '分', 'カット', '番目', '最初', '最後', '移動',
    '飛んで', '行って', '戻って', '見たい', '見せて', '開いて',
]);

const STRUCTURAL_WORDS = new Set(['item', 'cut', 'seg', 'the', 'target', 'time', 'spoken']);
const DISPLAY_ALIASES = Object.freeze({
    bgm: ['BGM', '音楽'],
    logo: ['ロゴ'],
    video: ['動画'],
    captions: ['字幕'],
    caption: ['字幕'],
    chart: ['チャート'],
    telop: ['テロップ'],
    point: ['ポイント'],
    title: ['タイトル'],
    card: ['カード'],
    person: ['人物'],
    lower: ['ローワー'],
    third: ['サード'],
});

const ID_VALUE_KEY = /^(?:id|ids|ID|IDs|key|keys|selection|target|seek_to|[A-Za-z0-9_]+Ids?)$/;
const ID_MAP_KEY = /^(?:item|cut|seg|person)(?=[:_-])/i;

function collectIds(value, ids, seen, key = '') {
    if (value == null) return;
    if (typeof value === 'string') {
        if (ID_VALUE_KEY.test(key) && value && value !== 'none') ids.add(value);
        if ((key === 'source' || key === 'edit') && /^[\s]*[\[{]/.test(value)) {
            try { collectIds(JSON.parse(value), ids, seen); } catch { /* source 以外の文字列は ID にしない */ }
        }
        return;
    }
    if (typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
        for (const entry of value) collectIds(entry, ids, seen, key);
        return;
    }
    for (const [childKey, child] of Object.entries(value)) {
        if (ID_MAP_KEY.test(childKey)) ids.add(childKey);
        collectIds(child, ids, seen, childKey);
    }
}

// POLICIES.md P2 の生成規則 1〜3を、現在の edit/state にある ID へ適用する。
export function projectElementWords(state) {
    const ids = new Set();
    collectIds(state, ids, new WeakSet());
    const fragments = new Set();
    for (const id of ids) {
        for (const part of id.toLowerCase().split(/[^a-z0-9]+/)) {
            if (part.length >= 2 && !STRUCTURAL_WORDS.has(part) && !/^\d+$/.test(part)) fragments.add(part);
        }
    }
    return [...new Set([
        ...ids,
        ...fragments,
        ...[...fragments].flatMap(part => DISPLAY_ALIASES[part] ?? []),
    ])];
}

export const passesP0Partial = () => true;

export function passesP2Partial(text, elementWords = []) {
    const value = String(text ?? '');
    return [...P2_FIXED_WORDS, ...elementWords].some(word => value.includes(word));
}

// getState は各途中経過で読み直す。source/context が差し替われば要素語も即座に変わる。
export function createP2PartialPredicate(getState) {
    if (typeof getState !== 'function') throw new TypeError('getState is required');
    const seenByOperation = new Map();
    const matchingWords = item => {
        let words = P2_FIXED_WORDS;
        try { words = [...words, ...projectElementWords(getState())]; }
        catch { /* 状態が読めないときは移動語だけで判定する */ }
        const text = String(item?.text ?? item ?? '');
        return words.filter(word => text.includes(word));
    };
    const predicate = item => {
        const words = matchingWords(item);
        const id = item?.operationId;
        const seen = seenByOperation.get(id) ?? new Set();
        const fresh = words.some(word => !seen.has(word));
        for (const word of words) seen.add(word);
        if (words.length) seenByOperation.set(id, seen);
        return fresh;
    };
    // 同じ語の伸長では既存の送信待ちを維持し、断片だけ最新に差し替える。
    // 言い直しでその対象語が消えた場合は scheduler が待機を取り消す。
    predicate.keepPending = (item, pending) => {
        const current = new Set(matchingWords(item));
        return matchingWords(pending).some(word => current.has(word));
    };
    predicate.reset = (...ids) => {
        if (ids.length) seenByOperation.delete(ids[0]);
        else seenByOperation.clear();
    };
    return predicate;
}
