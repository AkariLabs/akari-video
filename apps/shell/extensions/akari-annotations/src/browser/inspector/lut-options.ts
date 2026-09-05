import { INSPECTOR_LUT_PRESET_IDS } from './adjust-fields';

export function lutOptionLabel(value: string | undefined): string {
    return value?.startsWith('assets/luts/') ? `${value.slice('assets/luts/'.length)}（プロジェクト）` : value || 'なし';
}

export function buildLutOptions(projectRefs: readonly string[]): { label: string; value: string | null }[] {
    return [{ label: 'なし', value: null }, ...[...INSPECTOR_LUT_PRESET_IDS, ...projectRefs]
        .map(value => ({ label: lutOptionLabel(value), value }))];
}
