import { t } from './preview-text';
/** User-facing names for look fields that cannot be represented by a caption run. */
export function captionRunOmittedNotice(keys: readonly string[]): string | undefined {
    if (!keys.length) return undefined;
    const names: Record<string, string> = {
        animation: t('preview.captionStyle.warning.motionLabel'), background: t('preview.captionStyle.warning.backgroundPlateLabel'), shadow: t('preview.captionStyle.warning.shadowLabel'), glow: t('preview.captionStyle.warning.glowLabel'),
        font_family: t('preview.captionStyle.warning.fontLabel'), fontFamily: t('preview.captionStyle.warning.fontLabel'), line_height: t('preview.captionStyle.warning.lineSpacingLabel'), lineHeight: t('preview.captionStyle.warning.lineSpacingLabel'),
        text_transform: t('preview.captionStyle.warning.textTransformLabel'), reference_height_px: t('preview.captionStyle.warning.sizeBasisLabel'),
        size_px: t('preview.captionStyle.warning.sizeLabel'), sizePx: t('preview.captionStyle.warning.sizeLabel'), position: t('preview.captionStyle.warning.positionLabel'), layout: t('preview.contextBar.toolbar.alignmentLabel'),
        'stroke.method': t('preview.captionStyle.warning.outlineStyleLabel')
    };
    const labels = [...new Set(keys.map(key => names[key] ?? t('preview.captionStyle.warning.otherAppearanceLabel')))];
    return t('preview.captionStyle.warning.omittedAppearanceOptionsUnavailableTextRangesError', { p1: (labels.join(t('preview.previewWindow.punctuation.listSeparator'))) });
}
