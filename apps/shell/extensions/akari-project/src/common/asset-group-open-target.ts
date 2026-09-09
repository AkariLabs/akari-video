import type { AssetBinChildNode } from './asset-bin-grouping';

/** 素材グループ直下のファイルから、種別に合うクリック先を選ぶ（DOM・FS 非依存）。 */
export function assetGroupOpenTarget(children: readonly AssetBinChildNode[], category?: string): string | undefined {
    const names = children.filter(child => !child.isDirectory).map(child => child.name);
    if ((category === 'overlay' || category === 'still') && names.includes('fragment.html')) {
        return 'fragment.html';
    }
    if (category === 'font') {
        const font = names.filter(name => /\.(ttf|otf|woff2)$/i.test(name)).sort()[0];
        if (font) {
            return font;
        }
    }
    return ['preview.png', 'meta.json'].find(name => names.includes(name));
}
