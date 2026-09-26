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
