export const CHANNEL_ASK_MICROPHONE_ACCESS = 'AkariPreviewAskMicrophoneAccess';

export interface ElectronAkariPreviewApi {
    askForMicrophoneAccess(): Promise<boolean>;
}

declare global {
    interface Window {
        electronAkariPreview: ElectronAkariPreviewApi;
    }
}
