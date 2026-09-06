import type { InspectorWriteRequest, TimelineLayerSelection } from '../timeline-selection-model';

type MaskSourceOptions = NonNullable<TimelineLayerSelection['maskSourceOptions']>;
type MaskSnapshot = Pick<TimelineLayerSelection, 'id' | 'mask' | 'maskSourceOptions'>;

export function isMaskCandidatePath(path: string): boolean {
    return /\.(mp4|mov|webm|m4v|mkv)$/i.test(path);
}

export function maskSourceOptionsForSources(sources: ReadonlyMap<string, { path: string }>): MaskSourceOptions {
    return Array.from(sources).flatMap(([id, source]) => isMaskCandidatePath(source.path)
        ? [{ id, label: source.path.split(/[\\/]/).pop() || source.path }] : []);
}

export function maskOptionLabels(options: MaskSourceOptions): string[] {
    const counts = new Map<string, number>();
    for (const { label } of options) counts.set(label, (counts.get(label) ?? 0) + 1);
    const labels = options.map(({ id, label }) => counts.get(label)! > 1 || label === 'なし'
        ? `${label} (${id})` : label);
    // A filename may itself match a disambiguated label. Keep every selectable label unique.
    const reserved = new Set(['なし', ...labels]);
    const used = new Set(['なし']);
    return ['なし', ...labels.map((label, index) => {
        let unique = label;
        if (used.has(unique)) {
            unique = `${label} (${options[index].id})`;
            while (reserved.has(unique) || used.has(unique)) unique += ` (${options[index].id})`;
        }
        used.add(unique);
        return unique;
    })];
}

export function maskSourceIdForLabel(options: MaskSourceOptions, label: string): string | null {
    if (label === 'なし') return null;
    const index = maskOptionLabels(options).indexOf(label) - 1;
    if (index < 0) throw new Error('一覧からマスクを選択してください。');
    return options[index].id;
}

export function maskOptionLabel(options: MaskSourceOptions, id: string | undefined): string {
    if (id === undefined) return 'なし';
    const index = options.findIndex(option => option.id === id);
    return index < 0 ? id : maskOptionLabels(options)[index + 1];
}

export function createMaskWriteRequest(
    snapshot: MaskSnapshot, label: string
): Extract<InspectorWriteRequest, { kind: 'item-field' }> {
    if (snapshot.maskSourceOptions === undefined) throw new Error('media item だけが指定できます');
    return {
        kind: 'item-field', id: snapshot.id, path: 'mask',
        value: maskSourceIdForLabel(snapshot.maskSourceOptions, label)
    };
}
