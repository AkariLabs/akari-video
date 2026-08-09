export const CHANNEL_REVEAL_IN_FILE_MANAGER = 'AkariProjectRevealInFileManager';
export const CHANNEL_COPY_FILE_TO_CLIPBOARD = 'AkariProjectCopyFileToClipboard';

export interface RevealInFileManagerResult {
    readonly ok: boolean;
    readonly message?: string;
}

export interface CopyFileToClipboardResult {
    readonly ok: boolean;
    readonly message?: string;
}

export interface ElectronAkariProjectApi {
    revealInFileManager(fsPath: string): Promise<RevealInFileManagerResult>;
    copyFileToClipboard(fsPath: string): Promise<CopyFileToClipboardResult>;
}

declare global {
    interface Window {
        electronAkariProject: ElectronAkariProjectApi;
    }
}
