import { ResourceSample } from './statusbar-resources';

export const AKARI_STATUSBAR_RESOURCES_PATH = '/services/akari-statusbar-resources';
export const AkariStatusbarResourcesService = Symbol('AkariStatusbarResourcesService');

export interface AkariStatusbarResourcesService {
    sample(pids: number[]): Promise<ResourceSample>;
}
