export const PARTNER_LAST_KEY = 'akari.partner.last';

let shuttingDown = false;

export function markPartnerShuttingDown(): void { shuttingDown = true; }

export function isPartnerShuttingDown(): boolean { return shuttingDown; }

export function rememberPartnerClose(
    storage: { setData(key: string, value: unknown): Promise<void> }, userRequested: boolean,
    stopping = isPartnerShuttingDown()
): Promise<void> {
    return userRequested && !stopping
        ? storage.setData(PARTNER_LAST_KEY, { entryId: null, closedAt: new Date().toISOString() })
        : Promise.resolve();
}
