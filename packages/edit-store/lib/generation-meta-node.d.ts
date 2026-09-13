import type { GenerationMetaV1, ReadGenerationMetaResult } from './generation-meta';
export type { GenerationBinding, GenerationMetaV1, GenerationState, ReadGenerationMetaResult, } from './generation-meta';
export declare function readGenerationMeta(options: {
    projectRoot: string;
    sourcePath: string;
    now: Date | string | number;
}): ReadGenerationMetaResult;
export declare function findGenerationMetaBySha(options: {
    projectRoot: string;
    sha256: string;
}): GenerationMetaV1 | null;
