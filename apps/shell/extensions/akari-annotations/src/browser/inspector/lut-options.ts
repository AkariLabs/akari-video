import { t } from '@akari-video/i18n';
import { INSPECTOR_LUT_PRESET_IDS } from './adjust-fields';

// Display names from the bundled LUT catalog (presets/luts/index.jsonl); ids stay on disk.
const BUNDLED_LUT_NAMES: Readonly<Record<string, string>> = {
    natural: 'ナチュラル', cinematic: 'シネマティック', 'film-warm': '暖色フィルム',
    mono: 'モノクロ', 'silver-retain': '銀残し', 'vintage-fade': '退色レトロ',
    'cool-clear': 'クール透明感', 'night-neon': 'ナイトネオン',
    'forest-soft': 'フォレストソフト', 'sunset-gold': 'サンセットゴールド'
};

export function lutOptionLabel(value: string | undefined): string {
    return value?.startsWith('assets/luts/') ? t('inspector.lutOptions.label.project', { filename: value.slice('assets/luts/'.length) })
        : value ? BUNDLED_LUT_NAMES[value] ?? value : t('inspector.lutOptions.label.none');
}

export function buildLutOptions(projectRefs: readonly string[]): { label: string; value: string | null }[] {
    return [{ label: t('inspector.lutOptions.label.none'), value: null }, ...[...INSPECTOR_LUT_PRESET_IDS, ...projectRefs]
        .map(value => ({ label: lutOptionLabel(value), value }))];
}
