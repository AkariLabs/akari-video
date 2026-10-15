import { ManifestCheck, ProjectManifest, SceneEditInput } from './project-structure-model';

export const AKARI_PROJECT_STRUCTURE_PATH = '/services/akari-surfaces-project-structure';
export const AkariProjectStructureService = Symbol('AkariProjectStructureService');
export interface AkariProjectStructureService {
    readScenes(projectUri: string): Promise<SceneEditInput[]>;
    readManifest(projectUri: string): Promise<ProjectManifest | undefined>;
    readCheck(projectUri: string): Promise<ManifestCheck | undefined>;
    sync(projectUri: string): Promise<ProjectManifest | undefined>;
}
