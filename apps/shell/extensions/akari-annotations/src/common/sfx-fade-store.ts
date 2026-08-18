import {
    findMatchingBracket,
    splitTopLevelElements,
    updateArrayElementByIndex
} from '@akari-video/edit-store/lib/edit-store';

/**
 * audio.sfx[].fade_in/fade_out の書き戻し（task 2026-08-18-audio-clip-fades）。
 *
 * 正本は packages/edit-store（apps/shell/extensions/akari-annotations/src/common/edit-store.ts
 * のヘッダに明記のとおり、edit.json のテキスト手術は本来そちらに置く）だが、本タスクのファイル
 * 境界は packages/edit-store を含まないため、ここでは境界内で完結する独立実装として置く。
 * 括弧対応・要素分割・配列インデックス走査は edit-store が export 済みの汎用ユーティリティ
 * （findMatchingBracket / splitTopLevelElements / updateArrayElementByIndex）をそのまま再利用し、
 * 個々のプロパティ読み書き（append/replace/remove）だけを edit-store.ts 内の同名・非 export
 * ヘルパーと同じ最小 diff 方針でここに複製する（setSfxGainDbInSource / updateBgmInSource と
 * 同型の書き戻り文字列になるように）。
 */

const JSON_NUMBER = '-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';

function appendNumberProperty(source: string, property: string, value: number): string {
    const closeIndex = source.lastIndexOf('}');
    if (closeIndex < 0) {
        throw new Error('SE のオブジェクトを特定できません。');
    }
    const beforeClose = source.slice(0, closeIndex);
    const trailingWhitespace = beforeClose.match(/\s*$/)?.[0] ?? '';
    const body = beforeClose.slice(0, beforeClose.length - trailingWhitespace.length);
    if (!body.trim().endsWith('{')) {
        if (source.includes('\n')) {
            const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
            const propertyIndent = source.match(/(?:^|\r?\n)([ \t]+)"[^"\r\n]+"\s*:/)?.[1] ?? '  ';
            return `${body},${lineEnding}${propertyIndent}"${property}": ${JSON.stringify(value)}${trailingWhitespace}${source.slice(closeIndex)}`;
        }
        return `${body}, "${property}": ${JSON.stringify(value)}${trailingWhitespace}${source.slice(closeIndex)}`;
    }
    return `${body}"${property}": ${JSON.stringify(value)}${trailingWhitespace}${source.slice(closeIndex)}`;
}

function replacePropertyValue(source: string, property: string, value: number, label: string): string {
    const pattern = new RegExp(`("${property}"\\s*:\\s*)${JSON_NUMBER}`, 'g');
    const matches = [...source.matchAll(pattern)];
    if (matches.length !== 1) {
        throw new Error(`${label} の ${property} を特定できません。`);
    }
    return source.replace(pattern, (_match, prefix: string) => `${prefix}${JSON.stringify(value)}`);
}

function removeObjectProperty(source: string, property: string): string {
    const openIndex = source.indexOf('{');
    const closeIndex = openIndex >= 0 ? findMatchingBracket(source, openIndex) : -1;
    if (openIndex < 0 || closeIndex < 0) {
        throw new Error('SE のオブジェクトを特定できません。');
    }
    const inner = source.slice(openIndex + 1, closeIndex);
    const elements = splitTopLevelElements(inner);
    const index = elements.findIndex(element => new RegExp(`^"${property}"\\s*:`).test(element.text));
    if (index < 0) {
        return source;
    }
    let nextInner: string;
    if (elements.length === 1) {
        nextInner = inner.slice(elements[0].end);
    } else if (index < elements.length - 1) {
        nextInner = inner.slice(0, elements[index].start) + inner.slice(elements[index + 1].start);
    } else {
        nextInner = inner.slice(0, elements[index - 1].end) + inner.slice(elements[index].end);
    }
    return source.slice(0, openIndex + 1) + nextInner + source.slice(closeIndex);
}

/**
 * SE の fade_in/fade_out（秒）を書き戻す。null は「フィールドを削除して省略時意味論
 * （フェードなし）へ戻す」（undo 用、setBgmFields/trimSfxInSource と同じ流儀）。
 */
export function setSfxFadeInSource(
    source: string,
    sfxIndex: number,
    updates: { fadeIn?: number | null; fadeOut?: number | null }
): string {
    if (updates.fadeIn === undefined && updates.fadeOut === undefined) {
        throw new Error('変更する fade フィールドを指定してください。');
    }
    if (updates.fadeIn !== undefined && updates.fadeIn !== null
        && (!Number.isFinite(updates.fadeIn) || updates.fadeIn < 0)) {
        throw new Error('fade_in は 0 以上で指定してください。');
    }
    if (updates.fadeOut !== undefined && updates.fadeOut !== null
        && (!Number.isFinite(updates.fadeOut) || updates.fadeOut < 0)) {
        throw new Error('fade_out は 0 以上で指定してください。');
    }
    const label = `SE ${sfxIndex + 1}`;
    return updateArrayElementByIndex(source, 'sfx', sfxIndex, 'SE', element => {
        let next = element;
        const apply = (property: string, value: number | null | undefined): void => {
            if (value === undefined) {
                return;
            }
            const has = new RegExp(`"${property}"\\s*:`).test(next);
            if (value === null) {
                next = has ? removeObjectProperty(next, property) : next;
                return;
            }
            next = has
                ? replacePropertyValue(next, property, value, label)
                : appendNumberProperty(next, property, value);
        };
        apply('fade_in', updates.fadeIn);
        apply('fade_out', updates.fadeOut);
        return next;
    });
}
