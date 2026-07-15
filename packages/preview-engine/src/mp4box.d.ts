// @webav/mp4box.js は型定義を同梱していない（GPAC mp4box.js の再配布）。
// keyframeIndex.ts が使う範囲だけの最小アンビエント宣言。
declare module '@webav/mp4box.js' {
  export interface MP4BoxSample {
    number: number;
    track_id: number;
    timescale: number;
    dts: number;
    cts: number;
    duration: number;
    is_sync: boolean;
    size: number;
  }

  export interface MP4BoxTrackInfo {
    id: number;
    type?: string;
    video?: unknown;
    audio?: unknown;
  }

  export interface MP4BoxInfo {
    videoTracks: MP4BoxTrackInfo[];
    audioTracks: MP4BoxTrackInfo[];
    duration: number;
    timescale: number;
  }

  export interface ISOFile {
    onReady: ((info: MP4BoxInfo) => void) | null;
    onError: ((e: string) => void) | null;
    appendBuffer(data: ArrayBuffer & { fileStart: number }): void;
    flush(): void;
    getTrackSamplesInfo(trackId: number): MP4BoxSample[];
  }

  export function createFile(): ISOFile;
}
