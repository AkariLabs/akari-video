/** Only automatic requests are controlled by the persisted update preference. */
export function shouldRunNetworkCheck(autoCheck: boolean, intent: 'automatic' | 'user'): boolean {
    return intent === 'user' || autoCheck;
}

export async function runAutomaticNetworkCheck<T>(
    readSettings: () => Promise<{ autoCheck: boolean }>,
    request: () => Promise<T>
): Promise<T | undefined> {
    const settings = await readSettings().catch(() => ({ autoCheck: false }));
    return shouldRunNetworkCheck(settings.autoCheck, 'automatic') ? request() : undefined;
}
