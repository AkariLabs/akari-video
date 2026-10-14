import { t } from '@akari-video/i18n';
import { INSPECTOR_LUT_PRESET_IDS } from './adjust-fields';

const BUNDLED_LUT_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
    INSPECTOR_LUT_PRESET_IDS.map(id => [id, `inspector.lutOptions.preset.${id.replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase())}`]));

export function lutOptionLabel(value: string | undefined): string {
    return value?.startsWith('assets/luts/') ? t('inspector.lutOptions.label.project', { filename: value.slice('assets/luts/'.length) })
        : value ? (BUNDLED_LUT_KEYS[value] ? t(BUNDLED_LUT_KEYS[value]) : value) : t('inspector.lutOptions.label.none');
}

export function buildLutOptions(projectRefs: readonly string[]): { label: string; value: string | null }[] {
    return [{ label: t('inspector.lutOptions.label.none'), value: null }, ...[...INSPECTOR_LUT_PRESET_IDS, ...projectRefs]
        .map(value => ({ label: lutOptionLabel(value), value }))];
}
