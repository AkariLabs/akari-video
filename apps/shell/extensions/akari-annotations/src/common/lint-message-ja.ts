import { t } from '@akari-video/i18n';

export interface UiLintFinding {
    check?: string;
    severity?: string;
    message?: string;
    path?: string;
    preexisting?: boolean;
}

/** UI で短く案内する高頻度 check だけを持つ。詳細ログの英語本文は置き換えない。 */
const LINT_CHECK_KEYS: Readonly<Record<string, string>> = Object.freeze({
    'cuts.track-transition-unsupported': 'lint.check.cuts.trackTransitionUnsupported',
    'cuts.transition-out.non-adjacent': 'lint.check.cuts.transitionOutNonAdjacent',
    'cuts.transition-out.unknown-type': 'lint.check.cuts.transitionOutUnknownType',
    'cuts.transition-out.unknown-align': 'lint-messages.cuts.transition.unknownAlignCheck',
    'cuts.transition-out.unknown-fill': 'lint-messages.cuts.transition.unknownFillCheck',
    'cuts.transition-out.shortened': 'lint-messages.cuts.transition.shortenedCheck',
    'cuts.transition-out.freeze': 'lint-messages.cuts.transition.freezeCheck',
    'cuts.transition-out.zero-overlap': 'lint.check.cuts.transitionOutZeroOverlap',
    'cuts.transition-out.layer-evacuated': 'lint.check.cuts.transitionOutLayerEvacuated',
    'captions.overlap': 'lint.check.captions.overlap',
    'captions.cut-visibility': 'lint.check.captions.cutVisibility',
    'captions.output-domain-exceeds-duration': 'lint.check.captions.outputDomainExceedsDuration',
    'cuts.track-overlap': 'lint.check.cuts.trackOverlap',
    'references.files': 'lint.check.references.files',
    'overlays.timeline': 'lint.check.overlays.timeline',
    'audio.sfx.timeline': 'lint.check.audio.sfxTimeline'
});

// Keep the public export for consumers compiled against the original API.
export const LINT_CHECK_JA: Readonly<Record<string, string>> = new Proxy({}, {
    get: (_target, check: string | symbol) => typeof check === 'string' ? lintCheckMessage(check) : undefined,
    has: (_target, check: string | symbol) => typeof check === 'string' && check in LINT_CHECK_KEYS,
    ownKeys: () => Object.keys(LINT_CHECK_KEYS),
    getOwnPropertyDescriptor: (_target, check: string | symbol) => typeof check === 'string' && check in LINT_CHECK_KEYS
        ? { configurable: true, enumerable: true, value: lintCheckMessage(check) } : undefined
});

function lintCheckMessage(check: string | undefined): string | undefined {
    const key = check && LINT_CHECK_KEYS[check];
    return key ? t(key) : undefined;
}

/** pass verdict でも保存直後に知らせる、本タスク由来の transition warning だけ。 */
export const LINT_WARNING_SUMMARY_CHECKS: readonly string[] = Object.freeze([
    'cuts.transition-out.zero-overlap',
    'cuts.transition-out.layer-evacuated'
]);

export function lintCheckFromError(error: string | undefined): string | undefined {
    const match = /^\[([^\]]+)\]/u.exec(error ?? '');
    return match?.[1];
}

export function lintSummary(
    errors: readonly string[],
    findings: readonly UiLintFinding[] = []
): string | undefined {
    const finding = findings.find(candidate => candidate.severity === 'error' && candidate.check
        && LINT_CHECK_KEYS[candidate.check]);
    const check = finding?.check ?? lintCheckFromError(errors[0]);
    return lintCheckMessage(check);
}

export function japaneseLintSummary(errors: readonly string[], findings: readonly UiLintFinding[] = []): string | undefined {
    return lintSummary(errors, findings);
}

export function lintWarningSummary(
    findings: readonly UiLintFinding[] = []
): string | undefined {
    const finding = findings.find(candidate => candidate.severity === 'warning' && candidate.check
        && LINT_WARNING_SUMMARY_CHECKS.includes(candidate.check));
    return lintCheckMessage(finding?.check);
}

export function japaneseLintWarningSummary(findings: readonly UiLintFinding[] = []): string | undefined {
    return lintWarningSummary(findings);
}

/**
 * 辞書にある check は日本語要約 + 詳細を使い、日本語の詳細が十分な場合は重複を省く。
 */
export function formatLintFailureForUi(
    prefix: string,
    errors: readonly string[],
    findings: readonly UiLintFinding[] = []
): string {
    const detail = errors[0] ?? 'edit-lint error';
    const message = detail.replace(/^\[[^\]]+\]\s*/u, '');
    const firstFinding = findings.find(finding => finding.severity === 'error'
        && `[${finding.check ?? 'edit-lint'}] ${finding.message ?? ''}` === detail);
    const summary = lintSummary([detail], firstFinding ? [firstFinding] : []);
    const displayPrefix = prefix === t('lint.failure.prefix.validation', {}, 'ja')
        ? t('lint.failure.prefix.validation') : prefix;
    if (/^\s*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(message)) {
        return `${displayPrefix}: ${message}`;
    }
    return summary ? `${displayPrefix}: ${summary}${t('lint.failure.detail.label')}${detail}` : `${displayPrefix}: ${detail}`;
}
