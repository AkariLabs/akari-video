import type { EditAudioBgm, EditAudioNarration, EditAudioSfx, EditBeat, EditCut, EditLayer, EditOverlay, EditSource, EditTimelineTrack } from '../edit-store';
interface EditDefaultSource {
    path: string;
    proxy: string | null;
}
export interface EditParseOrigins {
    cuts: number[];
    overlays: number[];
    beats: number[];
    layers: number[];
    audioSfx: number[];
    audioNarration: number[];
}
export declare function parseEdit(source: string): {
    cuts: EditCut[];
    sources?: EditSource[];
    source?: EditDefaultSource;
    overlays: EditOverlay[];
    beats?: EditBeat[];
    layers: EditLayer[];
    audioSfx: EditAudioSfx[];
    audioNarration: EditAudioNarration[];
    audioBgm?: EditAudioBgm;
    timeline?: {
        tracks: EditTimelineTrack[];
    };
    fps: number;
    warnings: string[];
    origins: EditParseOrigins;
};
export {};
