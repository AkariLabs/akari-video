export const AkariEarService = Symbol('AkariEarService');
export const AKARI_EAR_SERVICE_PATH = '/services/akari-ear';

export type EarEngineId = 'speechanalyzer-live' | 'record-then-transcribe';
export type EarPurpose = 'trial' | 'note' | 'jev'; // 試し聞き / メモ / Jev。Jev の入口は設定 akari.vibe.mode が決める

export interface EarStatus {
    state: 'idle' | 'starting' | 'listening' | 'stopping' | 'error';
    engine?: EarEngineId;
    purpose?: EarPurpose;
    mic: 'unknown' | 'ok' | 'denied' | 'unsupported';
    message?: string; // 日本語。状況の行にそのまま出せる
}

export interface EarUtterance { // 1 発話
    id: string; // utterance-N
    raw: string; // エンジンの生出力
    text: string; // 辞書を当てたあと
    final: boolean;
    applied: Array<{ from: string; to: string; layer: 'builtin' | 'user'; id: string }>;
    t: number; // 開始からの経過秒
    kind?: 'speech' | 'command';
    confidence?: number;
}

export interface EarSegment { t0: number; t1: number; text: string; kind: 'speech' | 'command'; confidence?: number }
export interface EarTranscript { engine: 'speech-analyzer' | 'whisper' | 'typed'; locale: string; openedRecT: number; segments: EarSegment[] }
export type RoughCanvasEarEvent = { type: 'roughCanvas.opened' | 'roughCanvas.closed'; canvasId: string; at: number };

export interface AkariEarService {
    getCapabilities(): Promise<{ engines: Array<{ id: EarEngineId; available: boolean; reason?: string }> }>;
    start(options: { purpose: EarPurpose; engine?: EarEngineId }): Promise<EarStatus>;
    stop(): Promise<EarStatus>;
    notifyRoughCanvas(event: RoughCanvasEarEvent): Promise<void>;
    takeTranscript(canvasId: string): Promise<EarTranscript | undefined>;
    appendAudio(chunk: Uint8Array): Promise<void>;
    setClient(client: AkariEarClient | undefined): void;
}

export interface AkariEarClient {
    onStatus(status: EarStatus): void;
    onLevel(rms: number): void; // 約 10Hz（ヘルパー既定）
    onUtterance(utterance: EarUtterance): void;
}
