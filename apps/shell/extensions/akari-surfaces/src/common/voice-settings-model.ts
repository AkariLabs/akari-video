import type { NarrationEngineRow, SettingsVoiceAvatar, SettingsVoiceProfile } from './narration-engines-protocol';

export function falKeyAvailable(engine: NarrationEngineRow | undefined): boolean {
    return engine?.id === 'fal-qwen3' && engine.availability.state !== 'unconfigured';
}

export function voiceMigrationAvatar(profileAvatar: string | null | undefined, avatars: readonly SettingsVoiceAvatar[]): string {
    if (profileAvatar) return profileAvatar;
    if (avatars.length === 0) return 'me';
    if (avatars.length === 1) return avatars[0].id;
    return avatars.some(avatar => avatar.id === 'ryoma') ? 'ryoma' :
        [...avatars].sort((a, b) => a.id.localeCompare(b.id, 'en'))[0].id;
}

export function voiceAvatarLabel(id: string | null, avatars: readonly SettingsVoiceAvatar[]): string {
    return avatars.find(avatar => avatar.id === id)?.displayName ?? id ?? '—';
}

export function settingsVoiceEngineValue(preference: unknown, profiles: readonly SettingsVoiceProfile[], profilesLoaded = true): string {
    if (preference === 'gemini-tts' || preference === 'irodori') return preference;
    if (typeof preference === 'string' && preference.startsWith('voice:')
        && (!profilesLoaded || profiles.some(profile => `voice:${profile.id}` === preference))) return preference;
    return 'voicevox';
}

export function voiceSettingsActions(profile: SettingsVoiceProfile, irodoriAvailable: boolean, falAvailable: boolean): {
    migrate: boolean; rename: boolean; remove: boolean; addIrodori: boolean; addFal: boolean;
    remakeIrodori: boolean; remakeFal: boolean
} {
    if (profile.legacy) return { migrate: true, rename: false, remove: false, addIrodori: false,
        addFal: false, remakeIrodori: false, remakeFal: false };
    const self = typeof profile.consent === 'string' ? profile.consent.trim().length > 0 : profile.consent?.self_voice === true;
    const cloud = self && typeof profile.consent !== 'string' && profile.consent?.cloud_upload === true
        && (profile.verification?.score ?? 0) >= 0.7;
    const hasIrodori = profile.engines.includes('irodori');
    const hasFal = profile.engines.includes('fal-qwen3');
    return { migrate: false, rename: true, remove: true,
        addIrodori: self && irodoriAvailable && !hasIrodori,
        addFal: cloud && falAvailable && !hasFal,
        remakeIrodori: self && irodoriAvailable && hasIrodori && profile.copies?.irodori?.stale === true,
        remakeFal: cloud && falAvailable && hasFal && profile.copies?.['fal-qwen3']?.stale === true };
}
