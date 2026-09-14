import { KIT_ENABLE_HINT } from './kit-enable-hint';

export const KIT_LAB_URL = 'https://akari.video/lab/asset?id=world-kit';

export interface KitCardEntitledProduct {
    id: string;
    kind: string | null;
    currentVersion: number | null;
}

export interface KitCardKit {
    id: string;
    version: number | null;
    skills: string[];
    assetCount: number;
}

export interface KitCardInput {
    connected: boolean;
    entitledProducts: KitCardEntitledProduct[];
    installedKits: KitCardKit[];
    pluginEnabled: boolean | null;
}

export type KitCardModel =
    | { kind: 'hidden' }
    | { kind: 'installed'; kits: KitCardKit[]; showEnableHint: boolean; enableCommand: string }
    | { kind: 'purchased'; productIds: string[]; installCommand: string }
    | { kind: 'unpurchased'; labUrl: string };

export function buildKitCardModel(input: KitCardInput): KitCardModel {
    if (!input.connected) { return { kind: 'hidden' }; }
    if (input.installedKits.length > 0) {
        return {
            kind: 'installed',
            kits: input.installedKits,
            showEnableHint: input.pluginEnabled !== true,
            enableCommand: KIT_ENABLE_HINT
        };
    }
    const seen = new Set<string>();
    const productIds = input.entitledProducts.flatMap(product => {
        if (product.kind !== 'kit' || seen.has(product.id)) { return []; }
        seen.add(product.id);
        return [product.id];
    });
    if (productIds.length > 0) {
        return {
            kind: 'purchased',
            productIds,
            installCommand: productIds.map(id => `akari store install ${id}`).join('\n')
        };
    }
    return { kind: 'unpurchased', labUrl: KIT_LAB_URL };
}
