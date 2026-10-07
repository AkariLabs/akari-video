export const CHANNEL_PARTNER_WEB = 'AkariPartnerWeb';

export interface ElectronAkariPartnerApi {
    web: {
        ownerId(): Promise<string>;
    };
}
declare global {
    interface Window { electronAkariPartner: ElectronAkariPartnerApi; }
}
