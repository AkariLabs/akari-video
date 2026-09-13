import {
    GenerationCatalogModel, GenerationCatalogPrice, GenerationDefaultsSource, GenerationKind
} from './akari-connections-protocol';

export function formatGenerationPrice(price: GenerationCatalogPrice | null): string {
    if (!price) { return '見積不可'; }
    const values = Object.values(price.by_resolution);
    if (values.length === 0) { return '見積不可'; }
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const amount = minimum === maximum ? `$${minimum}/秒` : `$${minimum}〜${maximum}/秒`;
    return price.audio_multiplier === null ? amount : `${amount}（音声つき ×${price.audio_multiplier}）`;
}

export function formatGenerationAudio(audioOut: boolean | 'always'): string {
    return audioOut === 'always' ? '音声つき（固定）' : audioOut ? '音声つき（切替）' : '音声なし';
}

export function generationOptionLabel(model: GenerationCatalogModel): string {
    return [model.family, model.id, formatGenerationPrice(model.price), formatGenerationAudio(model.audio_out), `${model.as_of} 時点`].join(' · ');
}

export interface GenerationOption { value: string; label: string; missing: boolean }

export function generationOptions(
    models: readonly GenerationCatalogModel[], kind: GenerationKind, current: string | null
): GenerationOption[] {
    const options = models.filter(model => model.kind === kind).map(model => ({
        value: model.id, label: generationOptionLabel(model), missing: false
    }));
    if (typeof current === 'string' && current.trim() && !options.some(option => option.value === current)) {
        options.unshift({ value: current, label: `${current} · カタログにありません`, missing: true });
    }
    return options;
}

export function generationSourceLabel(source: GenerationDefaultsSource): string {
    return source === 'project' ? 'プロジェクト' : source === 'workspace' ? 'ワークスペース' : '既定';
}
