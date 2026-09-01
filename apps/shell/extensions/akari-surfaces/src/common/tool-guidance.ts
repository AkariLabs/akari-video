import type { AkariToolId } from './akari-new-project-protocol';

export interface ToolUiInfo {
    name: string;
    badge: string;
    purpose: string;
    /** ダウンロード容量の目安（表示用）。「約 300MB」形式。実装時に公式配布物の実サイズで確定してよい。 */
    sizeLabel: string;
    note?: string;
}

/** whisper 行のモデルサブ行の表示用サイズ（`tool-install.ts` の `WHISPER_MODEL_FILENAME` 実測サイズ）。 */
export const WHISPER_MODEL_SIZE_LABEL = '約574MB';

/**
 * 検知結果と分離した、UI に表示する案内の正本。
 * コマンド文字列（brew install ... / URL のベタ書き）は持たない — 導入手段は
 * `src/node/tool-install.ts` のインストールエンジンへ移した（裁定 A1）。
 */
export const TOOL_UI: Record<AkariToolId, ToolUiInfo> = {
    ffmpeg: {
        name: 'FFmpeg', badge: '基本 · ほぼ必須', purpose: '動画・音声の変換、プレビュー、書き出しに使います。',
        sizeLabel: '約 300MB'
    },
    whisper: {
        name: 'Whisper（whisper.cpp）', badge: '基本', purpose: '素材の文字起こしに使います。モデルは実行ファイルとは別に必要です。',
        sizeLabel: '約 20MB（+ モデル別途）'
    },
    'yt-dlp': {
        name: 'yt-dlp', badge: 'アドバンス · 既定 ON', purpose: '許可された動画素材の取得に使います。',
        sizeLabel: '約 35MB'
    },
    voicevox: {
        name: 'VOICEVOX', badge: 'アドバンス', purpose: 'ローカルの日本語ナレーション生成に使います。',
        sizeLabel: '約 1.5GB',
        note: '利用時は、音声ライブラリごとの規約に従ったクレジット表記が必要です。'
    },
    blender: {
        name: 'Blender CLI', badge: 'アドバンス', purpose: '高度な 3D 素材の事前レンダーに使います。',
        sizeLabel: '約 700MB'
    },
    'xcode-clt': {
        name: 'macOS: Command Line Tools', badge: '推奨', purpose: 'プロジェクトの履歴・差分・スナップショットと、AI 分析の高速文字起こし・目線バー・指フレーム・人物マットに使います。',
        sizeLabel: '約 2GB',
        note: '入れなくても動画は作れます。導入後に自動で有効になり、履歴機能と AI 分析機能で使われます。'
    }
};
