import { t } from '../common/project-text';
import type { BuildCaptionsResult } from './akari-project-protocol';

export function interpretCaptionsResult(exitCode: number, stdout: string, stderr: string): BuildCaptionsResult {
    if (exitCode === 1) {
        let diagnostic: { code?: string; needs_force?: boolean } | undefined;
        try { diagnostic = JSON.parse(stderr.trim()); } catch { /* Older CLI versions emit plain stderr. */ }
        if (diagnostic?.code === 'edited-captions' || diagnostic?.needs_force === true) return { needsForce: true };
        // Legacy captions CLI reports this condition only as a fixed stderr marker.
        if (stderr.includes('手直し済み')) return { needsForce: true };
    }
    if (exitCode !== 0) throw new Error(stderr.trim() || t('project.captions.result.generateCaptionsFailedError', { exitCode: exitCode }));
    const result: unknown = JSON.parse(stdout.trim());
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(t('project.captions.result.invalidCaptionsResultError'));
    return result as BuildCaptionsResult;
}
