import URI from '@theia/core/lib/common/uri';
import type {
    CreateAnnotationRequest,
    CreateAnnotationResult
} from 'akari-annotations/lib/common/akari-annotations-protocol';
import { isDocOrImageTarget } from 'akari-annotations/lib/common/annotation-store';
import type {
    CompanionAnnotateArgs,
    CompanionOperationResult
} from '../common/akari-companion-protocol';

export interface AnnotateDeps {
    currentProjectSessionId(): string | undefined;
    currentLocation(): { reviewUri: URI; root: URI } | undefined;
    createAnnotation(request: CreateAnnotationRequest): Promise<CreateAnnotationResult>;
}

function boundedNullableString(value: unknown): boolean {
    return value === undefined || value === null || (typeof value === 'string' && value.length <= 512);
}

export async function applyCompanionAnnotation(
    args: CompanionAnnotateArgs,
    deps: AnnotateDeps
): Promise<CompanionOperationResult> {
    if (!args || deps.currentProjectSessionId() !== args.projectSessionId) {
        return { ok: false, error: 'stale-session' };
    }
    if (typeof args.text !== 'string' || args.text.length === 0 || args.text.length > 2000) {
        return { ok: false, error: 'invalid-args' };
    }
    if (args.sourceT !== null && (typeof args.sourceT !== 'number'
        || !Number.isFinite(args.sourceT) || args.sourceT < 0)) {
        return { ok: false, error: 'invalid-args' };
    }
    if (args.sourceT === null && !isDocOrImageTarget(args.target ?? null)) {
        return { ok: false, error: 'invalid-args' };
    }
    if (args.sourceRange !== undefined && args.sourceRange !== null
        && (!Array.isArray(args.sourceRange) || args.sourceRange.length !== 2
            || !args.sourceRange.every(Number.isFinite) || args.sourceRange[0] >= args.sourceRange[1])) {
        return { ok: false, error: 'invalid-args' };
    }
    if (!boundedNullableString(args.src) || !boundedNullableString(args.target)) {
        return { ok: false, error: 'invalid-args' };
    }
    const location = deps.currentLocation();
    if (!location) return { ok: false, error: 'stale-session' };
    try {
        const result = await deps.createAnnotation({
            reviewUri: location.reviewUri.toString(),
            projectRootUri: location.root.toString(),
            src: args.src ?? null,
            sourceT: args.sourceT,
            sourceRange: args.sourceRange ?? null,
            timelineT: null,
            target: args.target ?? null,
            intent: 'external',
            text: args.text
        });
        return { ok: true, value: { annotationId: result.annotation.id } };
    } catch (error) {
        return {
            ok: false, error: 'rejected',
            value: { reasons: [String((error as Error)?.message ?? error)] }
        };
    }
}
