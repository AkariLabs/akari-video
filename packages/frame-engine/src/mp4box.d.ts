declare module '@webav/mp4box.js' {
  export interface MP4BoxSample {
    timescale: number;
    dts: number;
    cts: number;
    is_sync: boolean;
  }
  export interface MP4BoxInfo {
    videoTracks: Array<{ id: number }>;
  }
  export interface ISOFile {
    onReady: ((info: MP4BoxInfo) => void) | null;
    onError: ((message: string) => void) | null;
    appendBuffer(data: ArrayBuffer & { fileStart: number }): void;
    flush(): void;
    getTrackSamplesInfo(trackId: number): MP4BoxSample[];
  }
  export function createFile(): ISOFile;
}
