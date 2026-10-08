export const CHANNEL_PARTNER_WEB = 'AkariPartnerWeb';

export type PartnerWebTheme = 'dark' | 'light' | 'system';

export interface ElectronAkariPartnerApi {
    web: {
        ownerId(): Promise<string>;
        setTheme(ownerId: string, theme: PartnerWebTheme): Promise<void>;
    };
}
declare global {
    interface Window { electronAkariPartner: ElectronAkariPartnerApi; }
}
