import URI from '@theia/core/lib/common/uri';

export interface ProjectLocation {
    slug?: string;
    displayName?: string;
    root: URI;
    analysisUri: URI | undefined;
    videoUri: string;
    editUri: URI | undefined;
    captionsUri: URI;
    reviewUri: URI;
}
