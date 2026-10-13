type UriLike = { toString(): string };

export interface PreviewWatchedMediaSets {
    /** 届いた・書き換わった合図で読み直す素材（配信できなかった素材を含む）。 */
    akariPreviewWatchedMediaResources: Set<string>;
    akariPreviewWatchedMediaSuffixes: Set<string>;
    /** そのうち、直近の読み込みで配信できなかった素材。 */
    akariPreviewUnservedMediaResources: Set<string>;
    akariPreviewUnservedMediaSuffixes: Set<string>;
}

interface WatchedMediaModel<T extends UriLike> {
    /** この読み込みで配信できなかった素材（まだ届いていない画像など）。 */
    unservedUris?: readonly T[];
    /** cuts が使っている sources の実体。 */
    cutSourceUris: readonly T[];
}

/**
 * 読み直しのたびに「届いたら読み直す素材」を作り直す。
 *
 * edit.json や HTML の断片が先に書かれ、素材の実体があとから置かれることがある
 * （エージェントが画像を生成している間など）。配信できなかった素材は追跡対象
 * （配信できた資産）に入らないため、届いても読み直しが起きなかった。
 *
 * - 今回配信できなかった素材は必ず見張る。
 * - 静止画の cut ソースは画像レイヤーと同じ扱いで常に見張る（同じ名前での作り直しを拾う）。
 * - 一度待った cut ソースは、cuts が使っている間は見張り続ける（届いた直後の書き足しを拾う）。
 *   動画の cut ソースを最初から全部見張らないのは、書き込み中の大きな動画で再構築が続くのを避けるため。
 */
export function previewWatchedMediaSets<T extends UriLike>(
    previous: Partial<PreviewWatchedMediaSets>,
    model: WatchedMediaModel<T>,
    suffix: (uri: T) => string,
    isStillImage: (uri: T) => boolean
): PreviewWatchedMediaSets {
    const waited = previous.akariPreviewWatchedMediaResources ?? new Set<string>();
    const unserved = [...(model.unservedUris ?? [])];
    const watched = [
        ...unserved,
        ...model.cutSourceUris.filter(uri => isStillImage(uri) || waited.has(uri.toString()))
    ];
    return {
        akariPreviewWatchedMediaResources: new Set(watched.map(uri => uri.toString())),
        akariPreviewWatchedMediaSuffixes: new Set(watched.map(suffix)),
        akariPreviewUnservedMediaResources: new Set(unserved.map(uri => uri.toString())),
        akariPreviewUnservedMediaSuffixes: new Set(unserved.map(suffix))
    };
}

/** 読み直しの途中で配信に失敗した素材を、次の作り直しを待たずに足す。 */
export function watchUnservedPreviewMedia<T extends UriLike>(
    sets: Partial<PreviewWatchedMediaSets>,
    uri: T,
    suffix: (uri: T) => string
): PreviewWatchedMediaSets {
    return {
        akariPreviewWatchedMediaResources: new Set(sets.akariPreviewWatchedMediaResources ?? []).add(uri.toString()),
        akariPreviewWatchedMediaSuffixes: new Set(sets.akariPreviewWatchedMediaSuffixes ?? []).add(suffix(uri)),
        akariPreviewUnservedMediaResources: new Set(sets.akariPreviewUnservedMediaResources ?? []).add(uri.toString()),
        akariPreviewUnservedMediaSuffixes: new Set(sets.akariPreviewUnservedMediaSuffixes ?? []).add(suffix(uri))
    };
}

/**
 * 変更されたファイルが見張り中の素材かを返す。
 * 'unserved' は届くのを待っている素材、'served' は配信できている素材（静止画の cut ソースなど）。
 */
export function previewWatchedMediaChange(
    sets: Partial<PreviewWatchedMediaSets>,
    resourceKey: string,
    resourceSuffix: string
): 'unserved' | 'served' | undefined {
    if (sets.akariPreviewUnservedMediaResources?.has(resourceKey)
        || sets.akariPreviewUnservedMediaSuffixes?.has(resourceSuffix)) return 'unserved';
    if (sets.akariPreviewWatchedMediaResources?.has(resourceKey)
        || sets.akariPreviewWatchedMediaSuffixes?.has(resourceSuffix)) return 'served';
    return undefined;
}

/** 新しく見張り始めた「配信できている」素材。取り込み直後の遅れた通知を読み直しにしないための印に使う。 */
export function newlyServedWatchedMedia(
    previous: Partial<PreviewWatchedMediaSets>,
    next: PreviewWatchedMediaSets
): { resources: string[]; suffixes: string[] } {
    return {
        resources: [...next.akariPreviewWatchedMediaResources].filter(key =>
            !next.akariPreviewUnservedMediaResources.has(key)
            && previous.akariPreviewWatchedMediaResources?.has(key) !== true),
        suffixes: [...next.akariPreviewWatchedMediaSuffixes].filter(key =>
            !next.akariPreviewUnservedMediaSuffixes.has(key)
            && previous.akariPreviewWatchedMediaSuffixes?.has(key) !== true)
    };
}
