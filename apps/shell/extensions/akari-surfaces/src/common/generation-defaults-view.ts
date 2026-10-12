import { t } from '@akari-video/i18n';
import {
    GenerationCatalogModel, GenerationCatalogPrice, GenerationDefaultsSource, GenerationKind
} from 'akari-shell-strip/lib/common/akari-connections-protocol';

export function formatGenerationPrice(price: GenerationCatalogPrice | null): string {
    if (!price) { return t('surfaces.generation.formatGenerationPriceEstimatePossible.label'); }
    const values = Object.values(price.by_resolution);
    if (values.length === 0) { return t('surfaces.generation.formatGenerationPriceEstimatePossible.label'); }
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const amount = minimum === maximum ? t('surfaces.generation.formatGenerationPriceSecond.message', { minimum: minimum }) : t('surfaces.generation.formatGenerationPriceSec.message', { minimum: minimum, maximum: maximum });
    return price.audio_multiplier === null ? amount : t('surfaces.generation.formatGenerationPriceAudio.message', { amount: amount, audioMultiplier: price.audio_multiplier });
}

export function formatGenerationAudio(audioOut: boolean | 'always'): string {
    return audioOut === 'always' ? t('surfaces.generation.formatGenerationAudioAudioFixed.label') : audioOut ? t('surfaces.generation.formatGenerationAudioAudioSwitch.label') : t('surfaces.generation.formatGenerationAudioNoAudio.label');
}

export function generationOptionLabel(model: GenerationCatalogModel): string {
    const name = model.id === 'codex:image' ? 'ChatGPT' : model.family;
    return [name, model.id, formatGenerationPrice(model.price), formatGenerationAudio(model.audio_out), t('surfaces.generation.generationOptionLabelTime.message', { asOf: model.as_of })].join(' · ');
}

export interface GenerationOption { value: string; label: string; missing: boolean }

export function generationOptions(
    models: readonly GenerationCatalogModel[], kind: GenerationKind, current: string | null
): GenerationOption[] {
    // This default is not consumed by the still panel or the still CLI yet.
    const options = models.filter(model => model.kind === kind && !(kind === 'image' && model.id === 'fal:gpt-image-2.5-flare')).map(model => ({
        value: model.id, label: generationOptionLabel(model), missing: false
    }));
    if (typeof current === 'string' && current.trim() && !options.some(option => option.value === current)) {
        options.unshift({ value: current, label: t('surfaces.generation.generationOptionsLabel.label', { model: current, availability: current === 'fal:gpt-image-2.5-flare' ? t('surfaces.generation.generationOptionsCannotSelectedScreen.label') : t('surfaces.generation.generationOptionsCatalog.label') }), missing: true });
    }
    return options;
}

export function generationSourceLabel(source: GenerationDefaultsSource): string {
    return source === 'project' ? t('surfaces.generation.generationSourceLabelProject.label') : source === 'workspace' ? t('surfaces.generation.generationSourceLabelWorkSpace.label') : t('surfaces.generation.generationSourceLabelDefault.label');
}
