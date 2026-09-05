export interface ExtensionFreshnessInput {
    installedVersion?: string;
    latestVersion?: string;
}

export type ExtensionFreshnessReason =
    'not-installed' | 'registry-unavailable' | 'unparsable' | 'up-to-date' | 'newer-available';

export interface ExtensionFreshnessDecision extends ExtensionFreshnessInput {
    action: 'update' | 'none';
    reason: ExtensionFreshnessReason;
}

function parseVersion(value: string): number[] | undefined {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim().replace(/^v/, ''));
    return match ? match.slice(1).map(Number) : undefined;
}

/** 先頭 v・prerelease・build metadata を除く数値の三つ組を -1 / 0 / 1 で比較する。 */
export function compareVersions(a: string, b: string): number {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    if (!pa || !pb) {
        return 0;
    }
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) {
            return pa[i] < pb[i] ? -1 : 1;
        }
    }
    return 0;
}

export function decideExtensionUpdate(input: ExtensionFreshnessInput): ExtensionFreshnessDecision {
    const { installedVersion, latestVersion } = input;
    let reason: ExtensionFreshnessReason;
    if (!installedVersion) {
        reason = 'not-installed';
    } else if (!latestVersion) {
        reason = 'registry-unavailable';
    } else if (!parseVersion(installedVersion) || !parseVersion(latestVersion)) {
        reason = 'unparsable';
    } else {
        reason = compareVersions(latestVersion, installedVersion) > 0 ? 'newer-available' : 'up-to-date';
    }
    return { action: reason === 'newer-available' ? 'update' : 'none', reason, installedVersion, latestVersion };
}

export function formatExtensionUpdateNotice(name: string, from: string, to: string): string {
    return `${name} を ${from} → ${to} に更新しました。反映には再読み込みが必要です`;
}
