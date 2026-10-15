import type URI from '@theia/core/lib/common/uri';
import type { ProjectLocation } from './project-location';

export const ProjectReviewLocation = Symbol('ProjectReviewLocation');

export interface ProjectReviewLocation {
    findReviewLocationForProjectRoot(root: URI): Promise<ProjectLocation | undefined>;
}
