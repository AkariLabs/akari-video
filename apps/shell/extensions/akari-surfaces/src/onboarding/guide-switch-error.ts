export const GUIDE_PARTNER_STOP_ERROR_CODE = 'AKARI_GUIDE_PARTNER_STOP_FAILED';

export class GuidePartnerStopError extends Error {
    readonly code = GUIDE_PARTNER_STOP_ERROR_CODE;

    constructor() {
        super('Partner terminal termination could not be confirmed');
        this.name = 'GuidePartnerStopError';
    }
}

export function isGuidePartnerStopError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error
        && error.code === GUIDE_PARTNER_STOP_ERROR_CODE;
}

export async function switchGuideProject(
    busy: boolean,
    busyConfirmed: boolean,
    stopPartner: () => Promise<void>,
    openProject: () => Promise<void>
): Promise<void> {
    if (busy && !busyConfirmed) throw new Error('Guide project switch requires partner consent');
    if (busyConfirmed) {
        try { await stopPartner(); }
        catch { throw new GuidePartnerStopError(); }
    }
    await openProject();
}
