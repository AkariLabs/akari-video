import URI from '@theia/core/lib/common/uri';
import type {
    WriteBackResult,
    WriteEditSnapshotRequest
} from 'akari-annotations/lib/common/akari-annotations-protocol';
import type {
    CompanionApplyEditArgs,
    CompanionOperationResult
} from '../common/akari-companion-protocol';

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export interface ApplyEditDeps {
    currentProjectSessionId(): string | undefined;
    currentLocation(): { editUri: URI; captionsUri: URI; root: URI } | undefined;
    readFileBytes(uri: URI): Promise<Uint8Array>;
    sha256Hex(bytes: Uint8Array): Promise<string>;
    writeEditSnapshot(request: WriteEditSnapshotRequest): Promise<WriteBackResult>;
    pushHistory(entry: { label: string; undo(): Promise<void>; redo(): Promise<void> }): void;
    notify(message: string): void;
}

interface DocumentSnapshot {
    editBytes: Uint8Array;
    captionsBytes: Uint8Array;
    editText: string;
    captionsText: string;
    editSha256: string;
    captionsSha256: string;
}

function errorMessage(error: unknown): string {
    return String((error as Error)?.message ?? error);
}

function validPatch(value: unknown): value is { baseSha256: string; nextText: string } {
    return typeof value === 'object' && value !== null
        && typeof (value as { baseSha256?: unknown }).baseSha256 === 'string'
        && typeof (value as { nextText?: unknown }).nextText === 'string';
}

async function readSnapshot(
    location: { editUri: URI; captionsUri: URI },
    deps: Pick<ApplyEditDeps, 'readFileBytes' | 'sha256Hex'>
): Promise<DocumentSnapshot> {
    const [editBytes, captionsBytes] = await Promise.all([
        deps.readFileBytes(location.editUri), deps.readFileBytes(location.captionsUri)
    ]);
    const [editSha256, captionsSha256] = await Promise.all([
        deps.sha256Hex(editBytes), deps.sha256Hex(captionsBytes)
    ]);
    const decoder = new TextDecoder();
    return {
        editBytes,
        captionsBytes,
        editText: decoder.decode(editBytes),
        captionsText: decoder.decode(captionsBytes),
        editSha256,
        captionsSha256
    };
}

export async function applyCompanionEdit(
    args: CompanionApplyEditArgs,
    deps: ApplyEditDeps
): Promise<CompanionOperationResult> {
    if (!args || deps.currentProjectSessionId() !== args.projectSessionId) {
        return { ok: false, error: 'stale-session' };
    }
    if ((!args.edit && !args.captions) || typeof args.label !== 'string' || args.label.length > 512
        || (args.edit !== undefined && !validPatch(args.edit))
        || (args.captions !== undefined && !validPatch(args.captions))) {
        return { ok: false, error: 'invalid-args' };
    }
    const encoder = new TextEncoder();
    const editNextBytes = args.edit ? encoder.encode(args.edit.nextText) : undefined;
    const captionsNextBytes = args.captions ? encoder.encode(args.captions.nextText) : undefined;
    if ((editNextBytes?.byteLength ?? 0) > MAX_DOCUMENT_BYTES
        || (captionsNextBytes?.byteLength ?? 0) > MAX_DOCUMENT_BYTES) {
        return { ok: false, error: 'too-large' };
    }
    try {
        if (args.edit) JSON.parse(args.edit.nextText);
        if (args.captions) JSON.parse(args.captions.nextText);
    } catch {
        return { ok: false, error: 'invalid-args' };
    }
    const location = deps.currentLocation();
    if (!location) return { ok: false, error: 'stale-session' };
    const before = await readSnapshot(location, deps);
    if ((args.edit && args.edit.baseSha256 !== before.editSha256)
        || (args.captions && args.captions.baseSha256 !== before.captionsSha256)) {
        return {
            ok: false, error: 'stale',
            value: { editSha256: before.editSha256, captionsSha256: before.captionsSha256 }
        };
    }
    const request = (editText?: string, captionsText?: string): WriteEditSnapshotRequest => ({
        editUri: location.editUri.toString(),
        projectRootUri: location.root.toString(),
        ...(editText !== undefined ? { editSource: editText } : {}),
        ...(captionsText !== undefined
            ? { captionsUri: location.captionsUri.toString(), captionsSource: captionsText } : {})
    });
    try {
        await deps.writeEditSnapshot(request(args.edit?.nextText, args.captions?.nextText));
    } catch (error) {
        return { ok: false, error: 'rejected', value: { reasons: [errorMessage(error)] } };
    }
    const afterEditSha256 = editNextBytes ? await deps.sha256Hex(editNextBytes) : before.editSha256;
    const afterCaptionsSha256 = captionsNextBytes
        ? await deps.sha256Hex(captionsNextBytes) : before.captionsSha256;

    const guardedRewrite = async (
        expected: { editSha256: string; captionsSha256: string },
        editText: string | undefined,
        captionsText: string | undefined
    ): Promise<void> => {
        const current = await readSnapshot(location, deps);
        const matches = (!args.edit || current.editSha256 === expected.editSha256)
            && (!args.captions || current.captionsSha256 === expected.captionsSha256);
        if (!matches) {
            deps.notify('ほかの変更が入ったため、この変更は元に戻せません');
            throw new Error('現在の内容が変更されています');
        }
        await deps.writeEditSnapshot(request(editText, captionsText));
    };

    deps.pushHistory({
        label: args.label,
        undo: () => guardedRewrite(
            { editSha256: afterEditSha256, captionsSha256: afterCaptionsSha256 },
            args.edit ? before.editText : undefined,
            args.captions ? before.captionsText : undefined
        ),
        redo: () => guardedRewrite(
            { editSha256: before.editSha256, captionsSha256: before.captionsSha256 },
            args.edit?.nextText,
            args.captions?.nextText
        )
    });
    return {
        ok: true,
        value: { editSha256: afterEditSha256, captionsSha256: afterCaptionsSha256 }
    };
}
