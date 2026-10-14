import { t } from '@akari-video/i18n';
import type { VoiceAvatar, VoiceCheckResult, VoiceEngine } from './akari-annotations-protocol';

export const GEMINI_CONSENT_TEXT = '私はこの音声の所有者であり、Googleがこの音声を使用して音声合成モデルを作成することを承認します。';
export const GEMINI_WATERMARK_NOTICE = t('annotationscommon.voiceCloneModel.message.googleAddsWatermarkVoiceCopy', {}, 'ja');
export function geminiWatermarkNotice(): string {
    return t('annotationscommon.voiceCloneModel.message.googleAddsWatermarkVoiceCopy');
}

export interface GeminiConsentCheck {
    pass?: boolean;
    reasons?: string[];
    checks?: { script?: { ok?: boolean | 'unavailable'; score?: number } };
}

export function geminiConsentReady(check?: GeminiConsentCheck): boolean {
    return check?.pass === true && check.checks?.script?.ok === true && (check.checks.script.score ?? 0) >= 0.8;
}

export function geminiConsentCanNext(audioPresent: boolean, check?: GeminiConsentCheck): boolean {
    return audioPresent && (check === undefined || geminiConsentReady(check));
}

export function geminiConsentStatus(check?: GeminiConsentCheck): string {
    if (!check) return '';
    if (geminiConsentReady(check)) return t('annotationscommon.voiceCloneModel.status.consentStatementMatchCheckedComputer', { percent: Math.round((check.checks?.script?.score ?? 0) * 100) });
    if (check.checks?.script?.ok === 'unavailable') return t('annotationscommon.voiceCloneModel.error.transcriptionUnavailableForSending');
    if (check.checks?.script?.ok === false || (check.checks?.script?.score ?? 0) < 0.8) return t('annotationscommon.voiceCloneModel.error.consentMatchBelowThreshold');
    return check.reasons?.[0] ?? t('annotationscommon.voiceCloneModel.error.consentRecordingInvalid');
}

export type VoiceStep = 'consent' | 'record' | 'check' | 'copy' | 'gemini-consent' | 'compare' | 'save';
export const VOICE_STEPS: VoiceStep[] = ['consent', 'record', 'check', 'copy', 'gemini-consent', 'compare', 'save'];
export function voiceStorageDisplay(root: string, home: string, avatar: string, id: string): string {
    const windows = /^[A-Za-z]:[\\/]/u.test(root);
    const separator = windows ? '\\' : '/';
    const normalized = (value: string): string => value.replace(/[\\/]/gu, separator).replace(/[\\/]+$/u, '');
    const base = normalized(root);
    const absolute = `${base}${separator}avatars${separator}${avatar}${separator}voice${separator}${id}${separator}`;
    const homePath = normalized(home);
    const compared = windows ? absolute.toLowerCase() : absolute;
    const prefix = windows ? `${homePath}${separator}`.toLowerCase() : `${homePath}${separator}`;
    return homePath && compared.startsWith(prefix) ? `~${absolute.slice(homePath.length)}` : absolute;
}
export function voiceNextStep(step: VoiceStep, direction: 1 | -1, copyCount?: number): VoiceStep {
    if (copyCount === 0 && step === 'copy' && direction === 1) return 'save';
    if (copyCount === 0 && step === 'save' && direction === -1) return 'copy';
    if (step === 'copy' && direction === 1) return 'compare';
    if (step === 'compare' && direction === -1) return 'copy';
    return VOICE_STEPS[Math.max(0, Math.min(VOICE_STEPS.length - 1, VOICE_STEPS.indexOf(step) + direction))];
}

export function voiceDefaultAvatar(avatars: readonly VoiceAvatar[], requested?: string): string {
    if (requested !== undefined) return requested;
    if (avatars.length === 0) return 'me';
    if (avatars.length === 1) return avatars[0].id;
    return avatars.some(avatar => avatar.id === 'ryoma') ? 'ryoma' :
        [...avatars].sort((a, b) => a.id.localeCompare(b.id, 'en'))[0].id;
}

export function voiceShouldDiscardProfileForRecording(profile: string | undefined, extending: boolean): boolean {
    return Boolean(profile) && !extending;
}

export function voiceCheckReason(check?: VoiceCheckResult): string {
    if (!check) return t('annotationscommon.voiceCloneModel.action.checkRecording');
    return check.reasons[0] ?? (check.pass ? '' : t('annotationscommon.voiceCloneModel.message.recordingDidNotPassValidation'));
}

export function voiceCanNext(step: VoiceStep, state: { consentSelf: boolean; audioPath?: string;
    check?: VoiceCheckResult; consentAudioPath?: string; consentCheck?: VoiceCheckResult; busy?: boolean; label?: string }): boolean {
    if (state.busy) return false;
    if (step === 'consent') return state.consentSelf;
    if (step === 'record') return Boolean(state.audioPath);
    if (step === 'check') return state.check?.pass === true;
    if (step === 'gemini-consent') return geminiConsentCanNext(Boolean(state.consentAudioPath), state.consentCheck);
    if (step === 'save') return Boolean(state.label?.trim());
    return true;
}

export function voiceGeminiConsentReady(check?: VoiceCheckResult): boolean {
    return geminiConsentReady(check);
}

export function voiceCopyDefaults(input: { irodoriAvailable: boolean; falAvailable: boolean;
    consentCloud: boolean; scriptOk: boolean | 'unavailable' }): VoiceEngine[] {
    return [
        ...(input.irodoriAvailable ? ['irodori' as const] : []),
        ...(input.falAvailable && input.consentCloud && input.scriptOk === true ? ['fal-qwen3' as const] : [])
    ];
}

export function voiceId(label: string, existing: readonly string[], fallback = 'voice'): string {
    const slug = label.replace(/ナレーション/gu, 'narration').normalize('NFKD').toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
    const base = !slug || slug === 'narration' ? fallback : slug;
    const ids = new Set(existing);
    if (!ids.has(base)) return base;
    let suffix = 2;
    while (ids.has(`${base}-${suffix}`)) suffix++;
    return `${base}-${suffix}`;
}

export function voiceCheckRows(check: VoiceCheckResult): Array<{ label: string; mark: '✓' | '!' | '✗'; detail: string }> {
    const { duration, level, noise, script } = check.checks;
    return [
        { label: t('annotationscommon.voiceCloneModel.label.duration'), mark: duration.ok ? '✓' : '✗', detail: t('annotationscommon.voiceCloneModel.detail.seconds15120Seconds', { duration: duration.value_s, n: duration.value_s }) },
        { label: t('annotationscommon.voiceCloneModel.label.volume'), mark: level.ok ? '✓' : '✗', detail: t('annotationscommon.voiceCloneModel.detail.peakDbAverageDb', { peak: level.peak_db, average: level.mean_db }) },
        { label: t('annotationscommon.voiceCloneModel.label.backgroundNoise'), mark: noise.warn ? '!' : '✓', detail: t('annotationscommon.voiceCloneModel.detail.silenceDb', { noiseFloor: noise.floor_db }) },
        { label: t('annotationscommon.voiceCloneModel.label.matchesScript'), mark: script.ok === false ? '✗' : script.ok === 'unavailable' ? '!' : '✓',
            detail: script.ok === 'unavailable' ? t('annotationscommon.voiceCloneModel.error.transcriptionUnavailableComputer') : t('annotationscommon.voiceCloneModel.label.transcriptionMatch', { percent: Math.round((script.score ?? 0) * 100), backend: script.backend ?? t('annotationscommon.voiceCloneModel.label.local') }) }
    ];
}
