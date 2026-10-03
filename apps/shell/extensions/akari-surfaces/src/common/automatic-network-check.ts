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

export function shouldShowPrivacyNotice(markerSeen: boolean): boolean {
    return !markerSeen;
}

export async function showPrivacyNoticeOnce(actions: {
    markerExists: () => Promise<boolean>;
    show: () => Promise<void>;
    markSeen: () => Promise<void>;
}): Promise<boolean> {
    if (!shouldShowPrivacyNotice(await actions.markerExists())) return false;
    await actions.show();
    await actions.markSeen();
    return true;
}

export async function saveAutomaticCheck(checked: boolean, actions: {
    writeSettings: (value: boolean) => Promise<void>;
    writePreference: (value: boolean) => Promise<void>;
}): Promise<void> {
    await actions.writeSettings(checked);
    await actions.writePreference(checked);
}
