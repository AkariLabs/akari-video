export const AKARI_KITS_SERVICE_PATH = '/services/akari-surfaces-kits';
export const AkariKitsService = Symbol('AkariKitsService');

export interface InstalledKit {
    id: string;
    version: number | null;
    skills: string[];
    assetCount: number;
}

export interface InstalledKitsResult {
    kits: InstalledKit[];
    pluginEnabled: boolean | null;
}

export interface AkariKitsService {
    readInstalledKits(): Promise<InstalledKitsResult>;
}
