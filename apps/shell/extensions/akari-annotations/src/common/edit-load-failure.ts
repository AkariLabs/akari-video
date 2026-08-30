import { FileOperationResult, FileSystemProviderErrorCode } from '@theia/filesystem/lib/common/files';

export type EditLoadFailure =
    | { kind: 'missing' }
    | { kind: 'reported' }
    | { kind: 'invalid'; notice: string };

export class ReportedEditLoadFailure extends Error {}

type FileErrorShape = {
    fileOperationResult?: unknown;
    code?: unknown;
};

/** edit.json の不在だけを従来どおり無音にし、それ以外は表示可能な失敗へ分類する。 */
export function classifyEditLoadFailure(error: unknown): EditLoadFailure {
    if (error instanceof ReportedEditLoadFailure) {
        return { kind: 'reported' };
    }
    const fileError = error as FileErrorShape | null;
    if (fileError && typeof fileError === 'object' && (
        fileError.fileOperationResult === FileOperationResult.FILE_NOT_FOUND
        || fileError.code === FileSystemProviderErrorCode.FileNotFound
    )) {
        return { kind: 'missing' };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'invalid', notice: `edit.json を読み込めませんでした: ${message}` };
}
