import type { BuildCaptionsResult } from './akari-project-protocol';

export function interpretCaptionsResult(exitCode: number, stdout: string, stderr: string): BuildCaptionsResult {
    if (exitCode === 1 && stderr.includes('手直し済み')) return { needsForce: true };
    if (exitCode !== 0) throw new Error(stderr.trim() || `字幕の生成に失敗しました (${exitCode})`);
    const result: unknown = JSON.parse(stdout.trim());
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('字幕の生成結果が不正です');
    return result as BuildCaptionsResult;
}
