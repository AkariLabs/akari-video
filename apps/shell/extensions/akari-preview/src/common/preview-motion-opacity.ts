/** Selects the single owner of opacity for each preview surface. */
export function previewDomOpacity(
    kind: 'media' | 'overlay', staticOpacity: number | undefined,
    frameEngineActive: boolean, runtimeEvaluatesMotion: boolean
): string | null {
    if (kind === 'media' && frameEngineActive) return '1';
    if (kind === 'overlay' && runtimeEvaluatesMotion) return null;
    return typeof staticOpacity === 'number' && Number.isFinite(staticOpacity)
        ? String(staticOpacity) : '';
}
