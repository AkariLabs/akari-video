export const CHANNEL_PARTNER_WEB = 'AkariPartnerWeb';

export interface PartnerWebRect {
    x: number; y: number; width: number; height: number; visible: boolean;
}
export interface PartnerWebInspect {
    viewBounds: { x: number; y: number; width: number; height: number };
    windowBounds: { x: number; y: number; width: number; height: number };
    url: string;
}
export interface ElectronAkariPartnerApi {
    web: {
        ownerId(): Promise<string>;
        open(url: string): Promise<void>;
        bounds(rect: PartnerWebRect): Promise<void>;
        close(): Promise<void>;
        inspect(): Promise<PartnerWebInspect>;
    };
}
declare global {
    interface Window { electronAkariPartner: ElectronAkariPartnerApi; }
}
