export const CHANNEL_REVEAL_IN_FILE_MANAGER = 'AkariProjectRevealInFileManager';

export interface RevealInFileManagerResult {
    readonly ok: boolean;
    readonly message?: string;
}

export interface ElectronAkariProjectApi {
    revealInFileManager(fsPath: string): Promise<RevealInFileManagerResult>;
}

declare global {
    interface Window {
        electronAkariProject: ElectronAkariProjectApi;
    }
}
