import { t } from '@akari-video/i18n';
import { AI_MODEL_KINDS, AiModel, AiModelKind, AiModelSet, AiModelPreferencesDocument } from './ai-models-protocol';
export const INPUT_LABELS: Record<string, string> = {
    prompt: t('surfaces.aiModels.instructions.label'), text: t('surfaces.aiModels.text.label'), first_frame: t('surfaces.aiModels.firstFrame.label'), last_frame: t('surfaces.aiModels.lastFrame.label'),
    reference_images: t('surfaces.aiModels.referenceImage.label'), reference_videos: t('surfaces.aiModels.referenceVideo.label'), reference_audios: t('surfaces.aiModels.referenceAudio.label'),
    source_video: t('surfaces.aiModels.originalVideo.label'), audio: t('surfaces.aiModels.audio.label'), video: t('surfaces.aiModels.video.label'), negative_prompt: t('surfaces.aiModels.thingsAvoid.label'), style: t('surfaces.aiModels.instructionsSay.label'), voice_clone: t('surfaces.aiModels.ownVoice.label'), speed: t('surfaces.aiModels.speed.label')
};
export const OUTPUT_LABELS: Record<string, string> = {
    aspects: t('surfaces.aiModels.angleView.label'), resolutions: t('surfaces.aiModels.resolution.label'), duration: t('surfaces.aiModels.duration.label'), audio_out: t('surfaces.aiModels.audio.label'), voices: t('surfaces.aiModels.voiceOptions.label'), seed: t('surfaces.aiModels.seed.label'), text: t('surfaces.aiModels.characters.label')
};

export type CapabilityState = 'unknown' | 'unavailable' | 'available';

/** G7 の null は未記入。不可は false / none / 空配列 / max:0 と明示された値だけ。 */
export function capabilityState(value: unknown): CapabilityState {
    if (value === null || value === undefined) {
        return 'unknown';
    }
    if (value === false || value === 'none') {
        return 'unavailable';
    }
    if (Array.isArray(value) && value.length === 0) {
        return 'unavailable';
    }
    if (typeof value === 'object' && !Array.isArray(value) && (value as { max?: unknown }).max === 0) {
        return 'unavailable';
    }
    return 'available';
}

export function supported(value: unknown): boolean {
    return capabilityState(value) === 'available';
}

export interface ModelFilters {
    kind: AiModelKind;
    query?: string;
    maker?: string;
    via?: 'included' | 'api' | 'all';
    need?: string;
    showUnavailable?: boolean;
    expanded?: readonly string[];
}

export function groupRepresentative(models: readonly AiModel[], group: string): AiModel | undefined {
    const members = models.filter(model => model.group === group);
    return members.find(model => model.main) || members[0];
}

export function filterAiModels(models: readonly AiModel[], filters: ModelFilters, makers: Record<string, {
    name: string;
}> = {}): AiModel[] {
    const query = filters.query?.trim().toLocaleLowerCase() || '';
    const filtered = models.filter(model => model.kind === filters.kind
        && (filters.showUnavailable || model.callable)
        && (!filters.maker || model.maker === filters.maker)
        && (!filters.via || filters.via === 'all' || (filters.via === 'api' ? model.via === 'api' : model.via !== 'api'))
        && (!filters.need || supported(model.inputs[filters.need]))
        && (!query || [model.name, model.family, model.group, model.maker, makers[model.maker]?.name,
            ...Object.entries(model.inputs).filter(([, value]) => supported(value)).map(([key]) => INPUT_LABELS[key] || key),
            ...Object.entries(model.outputs).filter(([, value]) => supported(value)).map(([key]) => OUTPUT_LABELS[key] || key)]
            .some(value => value?.toLocaleLowerCase().includes(query))));
    if (query || filters.maker || filters.need || (filters.via && filters.via !== 'all') || filters.showUnavailable) {
        return filtered;
    }
    const expanded = new Set(filters.expanded || []);
    return filtered.filter(model => groupRepresentative(filtered, model.group)?.id === model.id || expanded.has(model.group));
}

export function otherVariantCount(models: readonly AiModel[], model: AiModel, showUnavailable = false): number {
    return models.filter(row => row.kind === model.kind && row.group === model.group && row.id !== model.id && (showUnavailable || row.callable)).length;
}

export function comparisonKeys(models: readonly AiModel[], kind: AiModelKind, field: 'inputs' | 'outputs', labels: Record<string, string>): string[] {
    const sameKind = models.filter(model => model.kind === kind);
    // 全モデルで未確認または不可の項目は、その種類の入出力として意味がない。
    return Object.keys(labels).filter(key => sameKind.some(model => capabilityState(model[field][key]) === 'available'));
}

function maximumResolution(value: unknown): string | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const candidates = value.map(item => {
        const label = String(item);
        const upper = label.toUpperCase();
        const dimensions = /^(\d+)X(\d+)$/.exec(upper);
        if (dimensions) {
            return { label: label.replace('x', '×'), score: Math.max(Number(dimensions[1]), Number(dimensions[2])) };
        }
        const size = /^(\d+(?:\.\d+)?)K$/.exec(upper);
        if (size) {
            return { label, score: Number(size[1]) * 1024 };
        }
        const vertical = /^(\d+)P$/.exec(upper);
        if (vertical) {
            return { label, score: Number(vertical[1]) * 16 / 9 };
        }
        return { label, score: 0 };
    });
    return candidates.sort((left, right) => right.score - left.score)[0]?.label;
}

/** 比較表のセル。値が分かるものだけ短い数量に変換する。 */
export function aiModelResolutionText(model: AiModel): string {
    const sizes = model.outputs.akari_sizes;
    if (sizes && typeof sizes === 'object' && !Array.isArray(sizes)) {
        const entries = Object.entries(sizes);
        const [aspect, dimensions] = entries.find(([key]) => key === '16:9') || entries[0] || [];
        if (aspect && typeof dimensions === 'string') {
            const limit = maximumResolution(model.outputs.resolutions);
            return t('surfaces.aiModels.aiModelResolutionText.message', { aspect: aspect, dimensions: dimensions.replace('x', '×'), limit: limit ? t('surfaces.aiModels.resolutionLimit.label', { limit: limit }) : '' });
        }
    }
    return capabilityText('resolutions', model.outputs.resolutions);
}

export function capabilityText(key: string, value: unknown, model?: AiModel): string {
    const state = capabilityState(value);
    if (state === 'unknown') {
        return t('surfaces.aiModels.capabilityTextUnknown.label');
    }
    if (state === 'unavailable') {
        return t('surfaces.aiModels.capabilityTextPossible.label');
    }
    if (key === 'duration' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const duration = value as { min?: unknown; max?: unknown; values?: unknown };
        const values = Array.isArray(duration.values) ? duration.values.filter((item): item is number => typeof item === 'number') : [];
        const min = typeof duration.min === 'number' ? duration.min : values.length ? Math.min(...values) : null;
        const max = typeof duration.max === 'number' ? duration.max : values.length ? Math.max(...values) : null;
        if (min !== null && max !== null) {
            return min === max ? t('surfaces.aiModels.durationSingle.message', { max: max, n: max }) : t('surfaces.aiModels.durationRange.message', { min: min, max: max, n: max });
        }
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const maximum = (value as { max?: unknown }).max;
        if (typeof maximum === 'number') {
            const unit = key === 'reference_videos' ? t('surfaces.aiModels.videoUnit.label') : key === 'reference_audios' ? t('surfaces.aiModels.itemUnit.label') : t('surfaces.aiModels.capabilityTextSheet.label');
            return t('surfaces.aiModels.capabilityTextUp.message', { maximum: maximum, unit: unit });
        }
    }
    if (key === 'resolutions') {
        if (model?.outputs.akari_sizes) {
            return aiModelResolutionText(model);
        }
        const maximum = maximumResolution(value);
        return maximum ? `〜${maximum}` : t('surfaces.aiModels.capabilityTextAvailable.label');
    }
    if (Array.isArray(value)) {
        return t('surfaces.aiModels.capabilityTypeCount.label', { n: value.length });
    }
    return t('surfaces.aiModels.fieldPillsAvailable.label');
}

export function applyAiModelSet(set: AiModelSet, models: readonly AiModel[]): AiModelPreferencesDocument {
    const available = new Map(models.filter(model => model.callable).map(model => [model.id, model]));
    const defaults: AiModelPreferencesDocument['defaults'] = {};
    const favorites: AiModelPreferencesDocument['favorites'] = {};
    for (const kind of AI_MODEL_KINDS) {
        const preferred = set.defaults[kind];
        const fallback = (set.favorites[kind] || []).find(id => available.get(id)?.kind === kind);
        const selected = (preferred && available.get(preferred)?.kind === kind ? preferred : fallback)
            || models.find(model => model.kind === kind && model.callable)?.id;
        if (selected) {
            defaults[kind] = selected;
        }
        favorites[kind] = [...new Set((set.favorites[kind] || []).filter(id => available.get(id)?.kind === kind).concat(selected ? [selected] : []))];
    }
    return { version: 1, favorites, defaults };
}

export interface RadarAxis {
    key: string;
    label: string;
    value: number | null;
    display: string;
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
export function aiModelPriceValue(model: AiModel): number | null {
    if (model.via !== 'api') {
        return 0;
    }
    const price = model.price;
    if (!price) {
        return null;
    }
    const direct = number(price.value);
    if (direct !== null) {
        return direct;
    }
    const qualityRates = price.by_quality_1024;
    const defaultQuality = price.default_quality;
    if (qualityRates && typeof qualityRates === 'object' && !Array.isArray(qualityRates)
        && typeof defaultQuality === 'string') {
        const selected = number((qualityRates as Record<string, unknown>)[defaultQuality]);
        if (selected !== null) {
            return selected;
        }
    }
    for (const rates of [price.by_resolution, price.by_quality_1024]) {
        if (rates && typeof rates === 'object' && !Array.isArray(rates)) {
            const first = number(Object.values(rates)[0]);
            if (first !== null) {
                return first;
            }
        }
    }
    return null;
}

export function formatAiModelPrice(model: AiModel): string {
    if (model.via !== 'api') {
        return t('common.currency.price.extraFree');
    }
    const value = aiModelPriceValue(model);
    if (value === null) {
        return t('surfaces.aiModels.formatAiModelPricePriceConfirmed.label');
    }
    const unit = String(model.price?.unit ?? '');
    const quality = model.price?.default_quality;
    if (typeof quality === 'string' && model.price?.by_quality_1024) {
        const labels: Record<string, string> = { low: t('surfaces.aiModels.formatAiModelPriceLow.label'), medium: t('surfaces.aiModels.formatAiModelPriceMedium.label'), high: t('surfaces.aiModels.formatAiModelPriceHigh.label') };
        const params = { price: value.toFixed(3), quality: labels[quality] || quality };
        if (unit === 'usd_per_image') return t('surfaces.aiModels.pricePerImageQuality.label', params);
        if (unit === 'usd_per_second') return t('surfaces.aiModels.pricePerSecondQuality.label', params);
        if (unit === 'usd_per_1000_chars') return t('surfaces.aiModels.pricePerThousandCharactersQuality.label', params);
        if (unit === 'usd_per_hour') return t('surfaces.aiModels.pricePerHourQuality.label', params);
        return t('surfaces.aiModels.priceQualityWithoutUnit.label', params);
    }
    const params = { price: value };
    if (unit === 'usd_per_image') return t('surfaces.aiModels.pricePerImage.label', params);
    if (unit === 'usd_per_second') return t('surfaces.aiModels.pricePerSecond.label', params);
    if (unit === 'usd_per_1000_chars') return t('surfaces.aiModels.pricePerThousandCharacters.label', params);
    if (unit === 'usd_per_hour') return t('surfaces.aiModels.pricePerHour.label', params);
    return `$${value}`;
}

export function formatAiModelOtherPrices(model: AiModel): string {
    const rates = model.price?.by_quality_1024;
    const selected = model.price?.default_quality;
    if (!rates || typeof rates !== 'object' || Array.isArray(rates) || typeof selected !== 'string') {
        return '';
    }
    const labels: Record<string, string> = { low: t('surfaces.aiModels.formatAiModelOtherPricesLow.label'), medium: t('surfaces.aiModels.formatAiModelOtherPricesMedium.label'), high: t('surfaces.aiModels.formatAiModelOtherPricesHigh.label') };
    return Object.entries(rates).filter(([quality, value]) => quality !== selected && number(value) !== null)
        .map(([quality, value]) => `${labels[quality] || quality} $${(value as number).toFixed(3)}`).join(' · ');
}

function maxDuration(value: unknown): number | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const row = value as {
        max?: unknown;
        values?: unknown;
    };
    return number(row.max) ?? (Array.isArray(row.values) ? Math.max(...row.values.filter(item => typeof item === 'number')) : null);
}

function resolution(value: unknown): number | null {
    if (!Array.isArray(value) || !value.length) {
        return null;
    }
    const parsed = value.map(item => {
        const text = String(item).toUpperCase();
        const dimensions = /^(\d+)X(\d+)$/.exec(text);
        if (dimensions) {
            return Math.max(Number(dimensions[1]), Number(dimensions[2]));
        }
        if (text === '4K') {
            return 3840;
        }
        if (text === '2K') {
            return 2048;
        }
        if (text === '1080P') {
            return 1920;
        }
        if (text === '720P') {
            return 1280;
        }
        return null;
    }).filter((item): item is number => item !== null);
    return parsed.length ? Math.max(...parsed) : null;
}

export function radarAxes(model: AiModel): RadarAxis[] {
    const axes: RadarAxis[] = [];
    const add = (key: string, label: string, raw: number | null, max: number, display?: string): void => {
        axes.push({ key, label, value: raw === null ? null : clamp(raw / max), display: raw === null ? t('surfaces.aiModels.addUnknown.label') : display ?? String(raw) });
    };
    const cost = aiModelPriceValue(model);
    add('cost', t('surfaces.aiModels.radarAxesCheapness.label'), cost === null ? null : 1 / (1 + cost * 10), 1, cost === null ? undefined : formatAiModelPrice(model));
    if (model.kind === 'image') {
        const speed = number(model.speed_s);
        add('speed', t('surfaces.aiModels.radarAxesSpeed.label'), speed === null ? null : 1 / (1 + speed / 60), 1, speed === null ? undefined : t('surfaces.aiModels.radarAxesSeconds.message', { speed: speed, n: speed }));
        const refs = model.inputs.reference_images as {
            max?: unknown;
        } | undefined;
        add('references', t('surfaces.aiModels.radarAxesReferenceImage.label'), refs && number(refs.max) !== null ? number(refs.max) : supported(refs) ? 1 : 0, 16);
        const aspects = model.outputs.measured_aspects || model.outputs.aspects;
        add('aspects', t('surfaces.aiModels.radarAxesDegreeFreedomViewingAngle.label'), Array.isArray(aspects) ? aspects.length : null, 8);
        const akariSizes = model.outputs.akari_sizes;
        const akariLongEdge = akariSizes && typeof akariSizes === 'object' && !Array.isArray(akariSizes)
            ? resolution(Object.values(akariSizes)) : null;
        add('resolution', t('surfaces.aiModels.radarAxesResolution.label'), akariLongEdge ?? resolution(model.outputs.resolutions), 3840,
            akariLongEdge === null ? undefined : t('surfaces.aiModels.radarAxesUpPxAkari.message', { akariLongEdge: akariLongEdge }));
    }
    else if (model.kind === 'video') {
        add('duration', t('surfaces.aiModels.radarAxesLongestLength.label'), maxDuration(model.outputs.duration), 30);
        add('inputs', t('surfaces.aiModels.radarAxesInputWidth.label'), ['first_frame', 'last_frame', 'reference_images', 'reference_videos', 'reference_audios', 'source_video'].filter(key => supported(model.inputs[key])).length, 6);
        add('aspects', t('surfaces.aiModels.radarAxesDegreeFreedomViewingAngle.label'), Array.isArray(model.outputs.aspects) ? model.outputs.aspects.length : null, 8);
        add('resolution', t('surfaces.aiModels.radarAxesResolution.label'), resolution(model.outputs.resolutions), 3840);
    }
    else if (model.kind === 'voice') {
        add('voices', t('surfaces.aiModels.radarAxesVoiceOptions.label'), Array.isArray(model.outputs.voices) ? model.outputs.voices.length : null, 30);
        add('style', t('surfaces.aiModels.radarAxesInstructionsSay.label'), supported(model.inputs.style) ? 1 : 0, 1);
        add('clone', t('surfaces.aiModels.radarAxesOwnVoice.label'), supported(model.inputs.voice_clone) ? 1 : 0, 1);
        add('local', t('surfaces.aiModels.radarAxesMovesHand.label'), model.via === 'local' ? 1 : 0, 1);
    }
    else {
        add('local', t('surfaces.aiModels.radarAxesMovesHand.label'), model.via === 'local' ? 1 : 0, 1);
    }
    return axes;
}
