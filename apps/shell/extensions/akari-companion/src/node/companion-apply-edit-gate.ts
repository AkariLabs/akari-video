import { basename } from 'node:path';
import type {
    CompanionInstruction,
    CompanionProjectLocation,
    CompanionResultMessage
} from '../common/akari-companion-protocol';

export interface ApplyEditGateDeps {
    currentLocation(): CompanionProjectLocation | undefined;
    lintCandidates(projectRoot: string, candidates: Record<string, string>): Promise<{ pass: boolean; errors: string[] }>;
}

export async function gateCompanionApplyEdit(
    instruction: CompanionInstruction,
    deps: ApplyEditGateDeps
): Promise<CompanionResultMessage | undefined> {
    if (instruction.kind !== 'applyEdit' || !instruction.applyEdit) return undefined;
    const location = deps.currentLocation();
    if (!location || location.projectSessionId !== instruction.applyEdit.projectSessionId) {
        return { id: instruction.id, ok: false, error: 'stale-session' };
    }
    const candidates: Record<string, string> = {};
    if (instruction.applyEdit.edit) candidates[basename(location.editFsPath)] = instruction.applyEdit.edit.nextText;
    if (instruction.applyEdit.captions) {
        candidates[basename(location.captionsFsPath)] = instruction.applyEdit.captions.nextText;
    }
    if (Object.keys(candidates).length === 0) return undefined;
    const result = await deps.lintCandidates(location.rootFsPath, candidates);
    if (!result.pass) {
        return { id: instruction.id, ok: false, error: 'rejected', value: { reasons: result.errors } };
    }
    return undefined;
}
