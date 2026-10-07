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

/** Copy an entire referenced asset directory so sibling images and fonts keep their relative URLs. */
export function materializedFragmentPlan(declaredPath, itemId, nonce) {
    const segments = typeof declaredPath === 'string' ? declaredPath.replaceAll('\\', '/').split('/') : [];
    if (segments.length < 4 || segments[0] !== 'assets' || segments[1] !== 'overlay'
        || segments.some(part => !part || part === '.' || part === '..' || part.includes(':'))
        || typeof itemId !== 'string' || !itemId || !/^[a-zA-Z0-9_-]+$/.test(nonce)) {
        throw new Error('ライブラリ断片の参照先が不正です');
    }
    const sourceDirectory = segments.slice(0, 3).join('/');
    const itemSlug = itemId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48);
    const targetDirectory = `assets/overlay/${segments[2]}-edit-${itemSlug}-${nonce}`;
    return { sourceDirectory, targetDirectory,
        targetPath: `${targetDirectory}/${segments.slice(3).join('/')}` };
}

/** The placed item's edit.json supplies timing; library root timing must not travel into a project copy. */
export function withoutFragmentRootTiming(source, { preserveNaturalDuration = false } = {}) {
    let cursor = 0;
    while (cursor < source.length) {
        const start = source.indexOf('<', cursor);
        if (start < 0) break;
        if (source.startsWith('<!--', start)) {
            const end = source.indexOf('-->', start + 4);
            if (end < 0) throw new Error('HTML コメントが閉じていません');
            cursor = end + 3;
            continue;
        }
        const tag = /^<([A-Za-z][\w:-]*)(?:"[^"]*"|'[^']*'|[^'">])*>/u.exec(source.slice(start));
        if (!tag) { cursor = start + 1; continue; }
        if (/^(?:style|script)$/iu.test(tag[1])) {
            const closing = new RegExp(`</${tag[1]}\\s*>`, 'iu').exec(source.slice(start + tag[0].length));
            if (!closing) throw new Error('HTML の前置要素が閉じていません');
            cursor = start + tag[0].length + closing.index + closing[0].length;
            continue;
        }
        if (/^link$/iu.test(tag[1])) { cursor = start + tag[0].length; continue; }
        const nameEnd = tag[1].length + 1;
        const attributes = tag[0].slice(nameEnd, -1);
        const tokens = /([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gu;
        const removals = [];
        let duration = null;
        let hasNaturalDuration = false;
        for (const token of attributes.matchAll(tokens)) {
            if (preserveNaturalDuration && /^data-akari-natural-duration$/iu.test(token[1])) hasNaturalDuration = true;
            if (!/^data-(?:start|duration)$/iu.test(token[1])) continue;
            if (preserveNaturalDuration && /^data-duration$/iu.test(token[1])) {
                const value = token[0].match(/=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/u)?.slice(1).find(part => part !== undefined);
                if (value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0) duration = value;
            }
            let from = token.index;
            while (from > 0 && /\s/u.test(attributes[from - 1])) from--;
            removals.push([from, token.index + token[0].length]);
        }
        let changed = attributes;
        for (const [from, to] of removals.reverse()) changed = changed.slice(0, from) + changed.slice(to);
        if (preserveNaturalDuration && !hasNaturalDuration && duration !== null) changed += ` data-akari-natural-duration="${duration}"`;
        return source.slice(0, start + nameEnd) + changed + source.slice(start + tag[0].length - 1);
    }
    throw new Error('HTML 断片のルート要素がありません');
}

/** Change one authored item, leaving every other use of the shared library asset alone. */
export function replaceFragmentReference(editText, itemId, beforePath, afterPath, serializeEdit) {
    const edit = JSON.parse(editText);
    const items = edit.version === 2
        ? (edit.tracks ?? []).flatMap(track => track.items ?? [])
        : edit.overlays ?? [];
    const matches = items.filter(item => item?.id != null && String(item.id) === itemId);
    if (matches.length !== 1) throw new Error(`断片の item を一意に特定できません: ${itemId}`);
    const item = matches[0];
    if (edit.version === 2) {
        if (item.source?.kind !== 'html' || item.source.path !== beforePath) {
            throw new Error('断片の参照先が編集中に変わりました');
        }
        item.source.path = afterPath;
    } else {
        if (item.html !== beforePath) throw new Error('断片の参照先が編集中に変わりました');
        item.html = afterPath;
    }
    return serializeEdit(edit);
}
