import type { VoiceAvatar, VoiceCheckResult, VoiceEngine } from './akari-annotations-protocol';

export const GEMINI_CONSENT_TEXT = '私はこの音声の所有者であり、Googleがこの音声を使用して音声合成モデルを作成することを承認します。';
export const GEMINI_WATERMARK_NOTICE = '写しには Google の透かしが入ります';

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
    if (geminiConsentReady(check)) return `✓ 同意文との一致 ${Math.round((check.checks?.script?.score ?? 0) * 100)}% · この PC で照合しました`;
    if (check.checks?.script?.ok === 'unavailable') return 'この PC で聞き取りができないため送信できません。';
    if (check.checks?.script?.ok === false || (check.checks?.script?.score ?? 0) < 0.8) return '同意文との一致が 80% 未満です。録り直してください。';
    return check.reasons?.[0] ?? '同意録音のチェックに合格していません。';
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
    if (!check) return '録音を確かめてください。';
    return check.reasons[0] ?? (check.pass ? '' : '録音のチェックに合格していません。');
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
        { label: '長さ', mark: duration.ok ? '✓' : '✗', detail: `${duration.value_s} 秒（15〜120 秒）` },
        { label: '音の大きさ', mark: level.ok ? '✓' : '✗', detail: `ピーク ${level.peak_db} dB · 平均 ${level.mean_db} dB` },
        { label: 'まわりの音', mark: noise.warn ? '!' : '✓', detail: `無音部分 ${noise.floor_db} dB` },
        { label: '原稿どおりか', mark: script.ok === false ? '✗' : script.ok === 'unavailable' ? '!' : '✓',
            detail: script.ok === 'unavailable' ? 'この PC では聞き取りができません' : `聞き取り一致 ${Math.round((script.score ?? 0) * 100)}%（${script.backend ?? 'ローカル'}）` }
    ];
}
