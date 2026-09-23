export type InspectorSoloKind = 'cut' | 'layer' | 'caption' | 'audio' | 'overlay' | 'item';

export type InspectorSoloSelectionKind = InspectorSoloKind | 'multi' | 'world';

export interface InspectorSoloState {
    kind: InspectorSoloKind;
    tabId: string;
    sectionId?: string;
    fieldName?: string;
}

export interface InspectorSoloField {
    name?: string;
    label: string;
}

export interface InspectorSoloSection<TField extends InspectorSoloField> {
    id: string;
    fields: ReadonlyArray<TField>;
    optionalFields?: ReadonlyArray<TField>;
    enable?: { name: string };
    caption?: unknown;
    body?: unknown;
}

export function normalizeInspectorSoloKind(
    kind: InspectorSoloSelectionKind
): InspectorSoloKind | undefined {
    if (kind === 'world') return undefined;
    return kind === 'multi' ? 'caption' : kind;
}

export function inspectorSoloFieldName(field: InspectorSoloField): string {
    return field.name ?? field.label.toLowerCase().replace(/[^a-z0-9_-]+/giu, '-');
}

export function inspectorSoloSectionMatches(sectionId: string, requestedId: string): boolean {
    return sectionId === requestedId || sectionId.startsWith(`${requestedId}:`);
}

export function filterInspectorSoloSections<
    TField extends InspectorSoloField,
    TSection extends InspectorSoloSection<TField>
>(
    selectionKind: InspectorSoloSelectionKind,
    sections: readonly TSection[],
    solo: InspectorSoloState | undefined
): TSection[] {
    if (!solo || normalizeInspectorSoloKind(selectionKind) !== solo.kind) return [...sections];

    const candidates = solo.sectionId
        ? sections.filter(section => inspectorSoloSectionMatches(section.id, solo.sectionId!))
        : [...sections];
    if (!solo.fieldName) return candidates;

    return candidates.flatMap(section => {
        const fields = section.fields.filter(field => inspectorSoloFieldName(field) === solo.fieldName);
        const optionalFields = section.optionalFields?.filter(
            field => inspectorSoloFieldName(field) === solo.fieldName
        );
        const enable = section.enable?.name === solo.fieldName ? section.enable : undefined;
        if (fields.length === 0 && (optionalFields?.length ?? 0) === 0 && !enable) return [];
        const filtered = { ...section, fields } as TSection;
        if ('optionalFields' in section) filtered.optionalFields = optionalFields;
        if ('enable' in section) filtered.enable = enable;
        if ('caption' in section) filtered.caption = undefined;
        if ('body' in section) filtered.body = undefined;
        return [filtered];
    });
}
