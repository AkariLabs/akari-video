import type { AkariToolId } from './akari-new-project-protocol';

export interface ToolUiInfo {
    name: string;
    badge: string;
    purpose: string;
    install: string;
    note?: string;
}

/** 検知結果と分離した、UI に表示する案内の正本。自動インストール処理は持たない。 */
export const TOOL_UI: Record<AkariToolId, ToolUiInfo> = {
    ffmpeg: {
        name: 'FFmpeg', badge: '基本 · ほぼ必須', purpose: '動画・音声の変換、プレビュー、書き出しに使います。',
        install: 'macOS: brew install ffmpeg / Windows: winget install Gyan.FFmpeg'
    },
    whisper: {
        name: 'Whisper（whisper.cpp）', badge: '基本', purpose: '素材の文字起こしに使います。モデルは実行ファイルとは別に必要です。',
        install: 'macOS: brew install whisper-cpp（導入後にモデルも取得）'
    },
    chrome: {
        name: 'Chrome', badge: '基本', purpose: '字幕・オーバーレイ・サムネイルの描画確認に使います。',
        install: 'https://www.google.com/chrome/（Chromium / Edge / Brave も利用できます）'
    },
    'yt-dlp': {
        name: 'yt-dlp', badge: 'アドバンス · 既定 ON', purpose: '許可された動画素材の取得に使います。',
        install: 'macOS: brew install yt-dlp / Windows: winget install yt-dlp.yt-dlp'
    },
    voicevox: {
        name: 'VOICEVOX', badge: 'アドバンス', purpose: 'ローカルの日本語ナレーション生成に使います。',
        install: 'https://voicevox.hiroshiba.jp/',
        note: '利用時は、音声ライブラリごとの規約に従ったクレジット表記が必要です。'
    },
    blender: {
        name: 'Blender CLI', badge: 'アドバンス', purpose: '高度な 3D 素材の事前レンダーに使います。',
        install: 'macOS: brew install --cask blender / https://www.blender.org/download/'
    },
    'xcode-clt': {
        name: 'macOS: Command Line Tools', badge: '推奨', purpose: 'プロジェクトの履歴・差分・スナップショットと、AI 分析の高速文字起こし・目線バー・指フレーム・人物マットに使います。',
        install: 'ターミナルで実行: xcode-select --install',
        note: '入れなくても動画は作れます。導入後に自動で有効になり、履歴機能と AI 分析機能で使われます。'
    }
};
