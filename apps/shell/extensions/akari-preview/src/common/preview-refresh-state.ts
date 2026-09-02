export interface PreviewPlaybackState {
    timelineT: number;
    playing: boolean;
    rate: number;
}

export interface PreviewPlaybackTick {
    time: number;
    playing: boolean;
    rate?: number;
}

export interface PreviewRefreshRestoreInput {
    seekTimeOverride?: number;
    transport?: Pick<PreviewPlaybackState, 'timelineT' | 'playing'>;
    lastKnownTime?: number;
    lastKnownPlaying?: boolean;
}

export interface PreviewRefreshRestore {
    seekTime: number | undefined;
    playing: boolean;
}

/**
 * webview から来た tick を、再生中か否かに関係なく host 側の位置正本へ正規化する。
 * 一時停止中の手動シークも同じ経路を通すため、playing=false を値落ちさせない。
 */
export const capturePreviewPlaybackTick = (
    tick: PreviewPlaybackTick,
    previousRate = 1
): PreviewPlaybackState => {
    const fallbackRate = Number.isFinite(previousRate) && previousRate > 0 ? previousRate : 1;
    return {
        timelineT: Number.isFinite(tick.time) ? Math.max(0, tick.time) : 0,
        playing: tick.playing,
        rate: Number.isFinite(tick.rate) && tick.rate! > 0 ? tick.rate! : fallbackRate
    };
};

/** 再構築時の位置は明示値、transport、widget の直近 tick の順で選ぶ。 */
export const resolvePreviewRefreshRestore = (
    input: PreviewRefreshRestoreInput
): PreviewRefreshRestore => {
    const seekTime = [input.seekTimeOverride, input.transport?.timelineT, input.lastKnownTime]
        .find(value => Number.isFinite(value));
    return {
        seekTime: seekTime === undefined ? undefined : Math.max(0, seekTime),
        playing: input.transport?.playing ?? input.lastKnownPlaying ?? false
    };
};
