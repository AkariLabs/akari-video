import { compareVersions } from './extension-freshness';

/**
 * 拡張が同梱する CLI と、AKARI が管理する CLI のどちらを拡張に使わせるかを決める純粋ロジック。
 * 拡張の配布がプラットフォームによって止まると、同梱の CLI が古いままになり、CLI 形態では選べる
 * 新しいモデルが拡張の一覧に出ない。拡張が持つ「CLI の実体を指す設定」へ AKARI 管理の CLI を
 * 入れることで、拡張と CLI 形態が同じ CLI を使うようにする。
 */
export type ExtensionCliAlignmentReason =
    | 'managed-newer'
    | 'bundled-current'
    | 'no-managed-cli'
    | 'unknown-bundled-version'
    | 'unknown-managed-version'
    | 'unsupported';

export interface ExtensionCliAlignment {
    reason: ExtensionCliAlignmentReason;
    /** 拡張に使わせる AKARI 管理の CLI。同梱のほうが新しい・同じ・比べられないときは無い。 */
    executablePath?: string;
    bundledVersion?: string;
    managedVersion?: string;
    /** AKARI が管理する置き場の候補。設定の今の値を AKARI が入れたものかどうかの判定に使う。 */
    managedPaths: string[];
}

export function decideExtensionCliAlignment(input: {
    bundledVersion?: string;
    managedVersion?: string;
    managedExecutablePath?: string;
    managedPaths: string[];
}): ExtensionCliAlignment {
    const { bundledVersion, managedVersion, managedExecutablePath, managedPaths } = input;
    const base = { bundledVersion, managedVersion, managedPaths };
    if (!managedExecutablePath) return { ...base, reason: 'no-managed-cli' };
    if (!isVersion(managedVersion)) return { ...base, reason: 'unknown-managed-version' };
    if (!isVersion(bundledVersion)) return { ...base, reason: 'unknown-bundled-version' };
    return compareVersions(managedVersion, bundledVersion) > 0
        ? { ...base, reason: 'managed-newer', executablePath: managedExecutablePath }
        : { ...base, reason: 'bundled-current' };
}

function isVersion(value: string | undefined): value is string {
    return typeof value === 'string' && /^v?\d+\.\d+\.\d+/.test(value.trim());
}

export type ExtensionCliPreferenceDecision =
    | { action: 'keep' }
    | { action: 'set'; value: string }
    | { action: 'clear' };

/**
 * 設定の今の値と判定結果から、設定をどう書き換えるかを決める。
 * 利用者が自分で入れた値（AKARI の管理先ではないパス）には触れない。
 */
export function decideExtensionCliPreference(currentValue: unknown, alignment: ExtensionCliAlignment): ExtensionCliPreferenceDecision {
    const current = typeof currentValue === 'string' ? currentValue.trim() : '';
    const target = alignment.executablePath;
    if (!current) return target ? { action: 'set', value: target } : { action: 'keep' };
    if (!alignment.managedPaths.some(candidate => sameCliPath(candidate, current))) return { action: 'keep' };
    if (!target) {
        // 版を調べられなかっただけのときは、前に入れた値を消さない（次に調べられたときに決め直す）。
        return alignment.reason === 'bundled-current' || alignment.reason === 'no-managed-cli' ? { action: 'clear' } : { action: 'keep' };
    }
    return sameCliPath(target, current) ? { action: 'keep' } : { action: 'set', value: target };
}

/** Windows のパスは区切りと大文字小文字の違いを同じものとして比べる。 */
export function sameCliPath(a: string, b: string): boolean {
    const windows = /^[A-Za-z]:[\\/]/.test(a) || /^[A-Za-z]:[\\/]/.test(b);
    const normalize = (value: string) => windows ? value.replace(/\\/g, '/').toLowerCase() : value;
    return normalize(a) === normalize(b);
}
