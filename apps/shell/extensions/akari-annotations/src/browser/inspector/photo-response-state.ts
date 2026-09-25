export interface PhotoResponseBinding {
    itemId: string;
    sourceId: string;
    sourceUri: string;
    inputSha256: string;
    revision: string;
}

/** A completed inference may write only to the exact edit and source that started it. */
export function isCurrentPhotoResponse(binding: PhotoResponseBinding, current: {
    itemId: string; sourceId: string; sourceUri: string; inputSha256: string; revision: string;
}): boolean {
    return /^[a-f0-9]{64}$/u.test(binding.inputSha256)
        && binding.itemId === current.itemId
        && binding.sourceId === current.sourceId
        && binding.sourceUri === current.sourceUri
        && binding.inputSha256 === current.inputSha256
        && binding.revision === current.revision;
}
