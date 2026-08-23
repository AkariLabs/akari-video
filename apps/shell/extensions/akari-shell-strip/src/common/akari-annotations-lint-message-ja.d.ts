declare module 'akari-annotations/lib/common/lint-message-ja' {
    export interface UiLintFinding {
        check?: string;
        severity?: string;
        message?: string;
        path?: string;
    }

    export function japaneseLintSummary(
        errors: readonly string[],
        findings?: readonly UiLintFinding[]
    ): string | undefined;

    export function formatLintFailureForUi(
        prefix: string,
        errors: readonly string[],
        findings?: readonly UiLintFinding[]
    ): string;
}
