import { t } from '../common/project-text';
import { AssetResolveOutcome, ProjectAssetReference } from './akari-project-protocol';

/** Preserve the old copy response while accepting a reference without projectDir. */
export function assetResolveOutcome(result: {
    success: boolean; projectDir?: string; projectAssetPath?: string;
    referenced?: boolean; reference?: boolean; dir?: string; libraryDir?: string; error?: string;
}, declaredDirectory: string): AssetResolveOutcome {
    const libraryDir = result.libraryDir ?? result.dir;
    if (result.success && (result.referenced || result.reference) && libraryDir) {
        return { success: true, projectAssetPath: declaredDirectory, reference: true, libraryDir };
    }
    const projectAssetPath = result.projectAssetPath ?? result.projectDir;
    if (result.success && projectAssetPath) return { success: true, projectAssetPath };
    return { success: false, error: result.error ?? t('project.materials.reference.couldNotVerifyWhereAssetWasError') };
}

export function referencePresentation(reference: ProjectAssetReference, knownLab = false): {
    relativePath: string; missing: boolean; badge: string; recovery: string; lab: boolean;
} {
    const media: Record<string, RegExp> = {
        audio: /\.(wav|mp3|m4a|aac|flac|ogg|aif|aiff)$/i,
        broll: /\.(mp4|mov|m4v|webm|mkv|avi)$/i,
        still: /\.(png|jpe?g|webp|svg|gif|html?)$/i,
        overlay: /\.html?$/i, scene3d: /\.(glb|gltf|html?|blend)$/i, font: /\.(ttf|otf|woff2?)$/i
    };
    const missing = !reference.files.some(file => !/(^|\/)(meta\.json|preview\.png|CREDIT\.txt)$/i.test(file.name)
        && (media[reference.category]?.test(file.name) ?? true));
    const external = reference.tags?.some(tag => tag === 'origin:own' || tag === 'origin:site');
    const lab = !external && (reference.sourceKind === 'lab' || knownLab);
    return { relativePath: `assets/${reference.category}/${reference.id}`, missing,
        badge: missing ? t('project.materials.pane.notFoundError') : t('project.materials.reference.referenceLabel'), lab,
        recovery: lab ? t('project.materials.pane.downloadAgainAction') : t('project.materials.pane.importAgainAction') };
}

export function restrictedReferenceCount(references: readonly ProjectAssetReference[]): number {
    return references.filter(entry => entry.sourceKind === 'own' || entry.sourceKind === 'site'
        || entry.tags.some(tag => ['origin:own', 'origin:site', 'license:subscription'].includes(tag))).length;
}
