export interface CaptionStyleWrite {
    kind: string;
    id: string;
    value: string | number;
    targets?: ReadonlyArray<{ kind: 'caption'; id: string }>;
}

/** インスペクターと同じ選択スナップショットから、字幕 cue の id を得る。 */
export function contextCaptionId(selection: { kind: string; id?: string } | undefined,
    snapshot: { kind: string; id?: string } | undefined): string | undefined {
    if (snapshot?.kind === 'caption' && snapshot.id) return snapshot.id;
    return selection?.kind === 'caption' ? selection.id : undefined;
}

const FIELDS: Record<string, string> = {
    color: 'caption-style-color',
    strokeColor: 'caption-style-stroke-color',
    strokeWidth: 'caption-style-stroke-width',
    backgroundColor: 'caption-style-bg-color',
    backgroundOpacity: 'caption-style-bg-opacity',
    fontFamily: 'caption-style-font-family',
    sizePx: 'caption-style-size',
    lineHeight: 'caption-style-line-height',
    letterSpacingEm: 'caption-style-letter-spacing',
    weight: 'caption-style-font-weight'
};

/** ひとつの UI 操作を、既存の字幕スタイル書き込み 1 回に変換する。 */
export function captionStyleWrite(id: string, field: string, value: unknown,
    targetIds: readonly string[] = [id]): CaptionStyleWrite | undefined {
    const kind = FIELDS[field];
    if (!id || !kind || (typeof value !== 'string' && typeof value !== 'number')) return undefined;
    const targets = [...new Set(targetIds)].filter(Boolean).map(targetId => ({ kind: 'caption' as const, id: targetId }));
    if (!targets.some(target => target.id === id)) targets.unshift({ kind: 'caption', id });
    return { kind, id, value, ...(targets.length > 1 ? { targets } : {}) };
}

export async function runCaptionStyleWrite<T>(id: string, field: string, value: unknown,
    targetIds: readonly string[], write: (operation: CaptionStyleWrite) => Promise<T>): Promise<T | undefined> {
    const operation = captionStyleWrite(id, field, value, targetIds);
    return operation ? write(operation) : undefined;
}

export async function applyCaptionContextPreset(id: string, presetId: string, targetIds: readonly string[], deps: {
    readSource(): Promise<string>;
    setPreset(ids: string[], presetId: string): Promise<{ changed: number }>;
    writeSource(source: string): Promise<void>;
    recordHistory(entry: { label: string; undo(): Promise<void>; redo(): Promise<void> }): void;
    reload(): Promise<void>;
}): Promise<{ ok: boolean }> {
    const ids = [...new Set(targetIds.length ? targetIds : [id])];
    if (!ids.includes(id)) ids.unshift(id);
    const before = await deps.readSource();
    const result = await deps.setPreset(ids, presetId);
    if (result.changed === 0) return { ok: true };
    const after = await deps.readSource();
    deps.recordHistory({ label: '字幕のスタイルを変更',
        undo: async () => { await deps.writeSource(before); await deps.reload(); },
        redo: async () => { await deps.writeSource(after); await deps.reload(); } });
    await deps.reload();
    return { ok: true };
}

const DIRECT_FIELDS = new Set(['italic', 'underline', 'strikethrough', 'align', 'vertical',
    'vertical_align', 'text_transform', 'list', 'opacity']);

/** JSON の文字列を飛ばして値の終端を探す。cue 以外の書式は保持する。 */
function valueEnd(source: string, start: number): number {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let at = start; at < source.length; at++) {
        const char = source[at];
        if (quoted) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === '{' || char === '[') depth++;
        else if (char === '}' || char === ']') {
            if (depth === 0) return at;
            depth--;
            if (depth === 0) return at + 1;
        } else if (char === ',' && depth === 0) return at;
    }
    return source.length;
}

function topLevelField(source: string, field: string): { start: number; end: number } | undefined {
    let at = 1;
    while (at < source.length - 1) {
        while (/[\s,]/u.test(source[at] ?? '')) at++;
        if (source[at] !== '"') break;
        let keyEnd = at + 1;
        while (keyEnd < source.length) {
            if (source[keyEnd] === '\\') { keyEnd += 2; continue; }
            if (source[keyEnd++] === '"') break;
        }
        const key = JSON.parse(source.slice(at, keyEnd)) as string;
        at = keyEnd;
        while (/\s/u.test(source[at] ?? '')) at++;
        if (source[at++] !== ':') break;
        while (/\s/u.test(source[at] ?? '')) at++;
        const end = valueEnd(source, at);
        if (key === field) return { start: at, end };
        at = end;
    }
    return undefined;
}

function replaceCueField(source: string, id: string, field: string, value: unknown): string {
    const captions = /"captions"\s*:\s*\[/u.exec(source);
    const arrayStart = source.trimStart().startsWith('[') ? source.indexOf('[')
        : captions ? captions.index + captions[0].length - 1 : -1;
    if (arrayStart < 0) throw new Error('captions 配列がありません。');
    const start = arrayStart + 1;
    const end = valueEnd(source, start - 1);
    let at = start;
    while (at < end) {
        while (/[\s,]/u.test(source[at] ?? '') && at < end) at++;
        if (source[at] !== '{') break;
        const cueEnd = valueEnd(source, at);
        const cue = source.slice(at, cueEnd);
        const cueId = topLevelField(cue, 'id');
        if (cueId && JSON.parse(cue.slice(cueId.start, cueId.end)) === id) {
            const locatedStyle = topLevelField(cue, 'text_style');
            if (!locatedStyle) {
                const insertion = `,"text_style":{${JSON.stringify(field)}:${JSON.stringify(value)}}`;
                return source.slice(0, cueEnd - 1) + insertion + source.slice(cueEnd - 1);
            }
            const styleStart = at + locatedStyle.start;
            const styleEnd = at + locatedStyle.end;
            if (source[styleStart] !== '{') throw new Error(`字幕 ${id} の text_style はオブジェクトではありません。`);
            const style = source.slice(styleStart, styleEnd);
            const old = topLevelField(style, field);
            if (old) {
                const valueStart = styleStart + old.start;
                const valueStop = styleStart + old.end;
                return source.slice(0, valueStart) + JSON.stringify(value) + source.slice(valueStop);
            }
            return source.slice(0, styleEnd - 1) + `${style.slice(1, -1).trim() ? ',' : ''}${JSON.stringify(field)}:${JSON.stringify(value)}` + source.slice(styleEnd - 1);
        }
        at = cueEnd;
    }
    throw new Error(`字幕 ${id} がありません。`);
}

export async function applyCaptionContextField(id: string, field: string, value: unknown, targetIds: readonly string[], deps: {
    readSource(): Promise<string>;
    writeSource(source: string): Promise<void>;
    recordHistory(entry: { label: string; undo(): Promise<void>; redo(): Promise<void> }): void;
    reload(): Promise<void>;
}): Promise<{ ok: boolean }> {
    if (!DIRECT_FIELDS.has(field)) return { ok: false };
    const valid = field === 'align' ? ['left', 'center', 'right'].includes(value as string)
        : field === 'vertical_align' ? ['top', 'middle', 'bottom'].includes(value as string)
            : field === 'text_transform' ? ['upper', 'lower', 'none'].includes(value as string)
                : field === 'list' ? value === 'bullet' || value === null
                    : field === 'opacity' ? typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
                        : typeof value === 'boolean';
    if (!valid) return { ok: false };
    const ids = [...new Set([id, ...targetIds])];
    const before = await deps.readSource();
    let after = before;
    for (const targetId of ids) after = replaceCueField(after, targetId, field, value);
    if (after === before) return { ok: true };
    await deps.writeSource(after);
    deps.recordHistory({ label: '字幕の文字を変更',
        undo: async () => { await deps.writeSource(before); await deps.reload(); },
        redo: async () => { await deps.writeSource(after); await deps.reload(); } });
    await deps.reload();
    return { ok: true };
}
