export const PARTNER_LAST_KEY = 'akari.partner.last';

let shuttingDown = false;

export function markPartnerShuttingDown(): void { shuttingDown = true; }

export function isPartnerShuttingDown(): boolean { return shuttingDown; }

export function rememberPartnerClose(
    storage: { setData(key: string, value: unknown): Promise<void> }, userRequested: boolean,
    stopping = isPartnerShuttingDown(), remainingEntryId?: string
): Promise<void> {
    const now = new Date().toISOString();
    return userRequested && !stopping
        ? storage.setData(PARTNER_LAST_KEY, remainingEntryId
            ? { entryId: remainingEntryId, at: now }
            : { entryId: null, closedAt: now })
        : Promise.resolve();
}
