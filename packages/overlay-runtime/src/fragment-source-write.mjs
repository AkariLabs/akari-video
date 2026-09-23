/** Preserve author bytes when an inline edit changes text inside a fragment. */
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr']);
// Shell asset streams and Web UI fragment assets use different paths on the same temporary origin.
const SESSION_ASSET_URL = /https?:\/\/(?:127\.0\.0\.1|localhost):\d+\//i;

function hasSlotAttribute(tag, name) {
    const attributes = tag.slice(name.length + 1, -1);
    const attribute = /([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gu;
    return [...attributes.matchAll(attribute)].some(match => match[1].toLowerCase() === 'data-akari-slot');
}

function decodeText(value) {
    if (typeof document !== 'undefined') {
        const decoder = document.createElement('template');
        decoder.innerHTML = value;
        return (decoder.content.textContent ?? '').replace(/\r\n?|\r/g, '\n');
    }
    return value.replace(/&(#(?:x[0-9a-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
        const key = entity.toLowerCase();
        if (key[0] === '#') {
            const hex = key[1] === 'x';
            const code = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff
                ? String.fromCodePoint(code) : match;
        }
        return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' })[key] ?? match;
    }).replace(/\r\n?|\r/g, '\n');
}

function encodeText(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function textSpans(html, tags = []) {
    const spans = [];
    let cursor = 0;
    const slotStack = [];
    while (cursor < html.length) {
        if (html.startsWith('<!--', cursor)) {
            const end = html.indexOf('-->', cursor + 4);
            if (end < 0) throw new Error('HTML コメントが閉じていません');
            cursor = end + 3;
            continue;
        }
        if (html[cursor] === '<') {
            const tag = /^<(?:"[^"]*"|'[^']*'|[^'">])*>/u.exec(html.slice(cursor));
            if (!tag) throw new Error('HTML タグを解析できません');
            const closing = /^<\/\s*([\w:-]+)/u.exec(tag[0]);
            const opening = /^<([\w:-]+)/u.exec(tag[0]);
            cursor += tag[0].length;
            if (closing) {
                const frame = slotStack.pop();
                if (!frame?.inSlot || frame.isSlotRoot) tags.push('/' + closing[1].toLowerCase());
            } else if (opening) {
                const name = opening[1].toLowerCase();
                const parentInSlot = slotStack.length > 0 && slotStack[slotStack.length - 1].inSlot;
                if (!parentInSlot) tags.push(name);
                if ((name === 'style' || name === 'script') && !tag[0].endsWith('/>')) {
                    const close = new RegExp(`</${name}\\s*>`, 'ig');
                    close.lastIndex = cursor;
                    const end = close.exec(html);
                    if (!end) throw new Error(`${name} タグが閉じていません`);
                    cursor = close.lastIndex;
                } else if (!VOID_ELEMENTS.has(name) && !tag[0].endsWith('/>')) {
                    const isSlotRoot = !parentInSlot && hasSlotAttribute(tag[0], opening[1]);
                    slotStack.push({ inSlot: parentInSlot || isSlotRoot, isSlotRoot });
                }
            }
            continue;
        }
        const next = html.indexOf('<', cursor);
        const end = next < 0 ? html.length : next;
        if (slotStack.length > 0 && !slotStack[slotStack.length - 1].inSlot) {
            spans.push({ start: cursor, end, value: decodeText(html.slice(cursor, end)) });
        }
        cursor = end;
    }
    return spans;
}

/** Only differing text nodes may be written; changed markup is refused. */
export function patchFragmentSourceText(source, edited) {
    const beforeTags = [];
    const afterTags = [];
    const before = textSpans(source, beforeTags);
    const after = textSpans(edited, afterTags);
    if (before.length !== after.length || beforeTags.join('\0') !== afterTags.join('\0')) {
        throw new Error('断片の構造が変わったため、元ソースの文字だけを安全に保存できません');
    }
    let result = source;
    for (let index = before.length - 1; index >= 0; index--) {
        if (before[index].value === after[index].value) continue;
        result = result.slice(0, before[index].start) + encodeText(after[index].value) + result.slice(before[index].end);
    }
    return result;
}

export function assertNoSessionAssetUrl(source) {
    if (SESSION_ASSET_URL.test(source)) {
        throw new Error('一時的なプレビュー資産 URL が含まれるため、断片の保存を拒否しました');
    }
}
