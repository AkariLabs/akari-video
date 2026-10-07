export const VIBE_PREVIEW_KEY = 'akari.vibePreview.enabled';

/** 起動時に同期で読める設定の写し。未設定や壊れた値は常に off。 */
export function isVibePreviewEnabled(storage: Pick<Storage, 'getItem'> | undefined): boolean {
    try { return storage?.getItem(VIBE_PREVIEW_KEY) === '1'; }
    catch { return false; }
}
