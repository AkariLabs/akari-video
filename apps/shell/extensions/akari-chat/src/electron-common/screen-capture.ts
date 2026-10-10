export const CHAT_SCREEN_SOURCE = 'AkariChatScreenSource';
export interface ChatScreenSourceResult { id?: string; error?: string; warning?: string }
export interface ElectronAkariChatApi {
    screenSource(): Promise<ChatScreenSourceResult>;
}
declare global {
    interface Window { electronAkariChat?: ElectronAkariChatApi }
}
