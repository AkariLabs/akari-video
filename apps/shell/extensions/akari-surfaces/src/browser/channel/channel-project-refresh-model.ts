const FIRST_REFRESH_DELAY_MS = 120;
const REFRESH_INTERVAL_MS = 2000;

export function projectRefreshDelay(now: number, lastRefreshAt?: number): number {
    if (lastRefreshAt === undefined) return FIRST_REFRESH_DELAY_MS;
    return Math.max(0, lastRefreshAt + REFRESH_INTERVAL_MS - now);
}
