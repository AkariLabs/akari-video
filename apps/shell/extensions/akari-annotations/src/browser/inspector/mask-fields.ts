import { t } from '@akari-video/i18n';
import type { InspectorWriteRequest, TimelineLayerSelection } from '../timeline-selection-model';

type MaskSourceOptions = NonNullable<TimelineLayerSelection['maskSourceOptions']>;
type MaskSnapshot = Pick<TimelineLayerSelection, 'id' | 'mask' | 'maskSourceOptions'>;

export function isMaskCandidatePath(path: string, photo = false): boolean {
    return photo ? /\.png$/i.test(path) : /\.(mp4|mov|webm|m4v|mkv)$/i.test(path);
}

export function maskSourceOptionsForSources(sources: ReadonlyMap<string, { path: string }>, photo = false): MaskSourceOptions {
    let generatedCount = 0;
    return Array.from(sources).flatMap(([id, source]) => {
        if (!isMaskCandidatePath(source.path, photo)) return [];
        const generatedHash = source.path.match(/(?:^|[\\/])assets[\\/]masks[\\/]([a-f0-9]{64})\.png$/iu)?.[1];
        const generated = photo && generatedHash !== undefined && id === `mask-${generatedHash}`;
        if (generated) generatedCount += 1;
        const label = generated
            ? t('inspector.maskFields.label.maskBackground', { countSuffix: generatedCount === 1 ? '' : ` ${generatedCount}` })
            : source.path.split(/[\\/]/).pop() || source.path;
        return [{ id, label }];
    });
}

export function maskOptionLabels(options: MaskSourceOptions): string[] {
    const counts = new Map<string, number>();
    for (const { label } of options) counts.set(label, (counts.get(label) ?? 0) + 1);
    const labels = options.map(({ id, label }) => counts.get(label)! > 1 || label === t('inspector.maskFields.label.none')
        ? `${label} (${id})` : label);
    // A filename may itself match a disambiguated label. Keep every selectable label unique.
    const reserved = new Set([t('inspector.maskFields.label.none'), ...labels]);
    const used = new Set([t('inspector.maskFields.label.none')]);
    return [t('inspector.maskFields.label.none'), ...labels.map((label, index) => {
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
    if (label === t('inspector.maskFields.label.none')) return null;
    const index = maskOptionLabels(options).indexOf(label) - 1;
    if (index < 0) throw new Error(t('inspector.maskFields.error.selectMaskFromList'));
    return options[index].id;
}

export function maskOptionLabel(options: MaskSourceOptions, id: string | undefined): string {
    if (id === undefined) return t('inspector.maskFields.label.none');
    const index = options.findIndex(option => option.id === id);
    return index < 0 ? id : maskOptionLabels(options)[index + 1];
}

export function createMaskWriteRequest(
    snapshot: MaskSnapshot, label: string
): Extract<InspectorWriteRequest, { kind: 'item-field' }> {
    if (snapshot.maskSourceOptions === undefined) throw new Error(t('inspector.maskFields.error.onlyMediaItemCanBeSpecified'));
    return {
        kind: 'item-field', id: snapshot.id, path: 'mask',
        value: maskSourceIdForLabel(snapshot.maskSourceOptions, label)
    };
}
