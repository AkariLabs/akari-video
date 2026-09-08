import type { AkariToolCheckResult, AkariToolId } from './akari-new-project-protocol';

type ToolAvailability = Pick<AkariToolCheckResult, 'available' | 'unsupported' | 'needs'>
    & Partial<Pick<AkariToolCheckResult, 'id'>>;

/** 道具行の状態札。通常行は初回セットアップの既存文言を保つ。 */
export function describeToolAvailabilityLabel(tool: ToolAvailability): string {
    if (tool.unsupported) {
        return 'この OS では使えない';
    }
    if (tool.needs?.length) {
        return `準備が要る（${tool.needs.join('・')}）`;
    }
    if (tool.id && TOOL_UI[tool.id].osProvided) {
        return tool.available ? '使える' : '準備が要る';
    }
    return tool.available ? 'インストール済み' : '未インストール';
}

/** DOM に依存しない行描画の判定。unsupported は available より優先する。 */
export function deriveToolRowState(tool: ToolAvailability): { label: string; showCheckbox: boolean } {
    return { label: describeToolAvailabilityLabel(tool), showCheckbox: !tool.unsupported && !tool.available };
}

/** 利用条件の案内は準備できたら隠し、利用時の注意書きは残す。 */
export function shouldShowToolNote(tool: Pick<AkariToolCheckResult, 'id' | 'available'>): boolean {
    const info = TOOL_UI[tool.id];
    return Boolean(info.note) && !(info.hideNoteWhenAvailable && tool.available);
}

export const SPEECH_ANALYZER_MANUAL_INSTALL_GUIDANCE =
    'SpeechAnalyzer を使うには macOS 26 以上が必要です。Command Line Tools が無い場合は、ターミナルで xcode-select --install を実行して手動で入れる必要があります。完了したら再チェックしてください。';

export interface ToolUiInfo {
    name: string;
    badge: string;
    purpose: string;
    /** ダウンロード容量の目安（表示用）。「約 300MB」形式。実装時に公式配布物の実サイズで確定してよい。 */
    sizeLabel: string;
    note?: string;
    /** OS 付属の機能であり、自動導入せず利用条件を案内する。 */
    osProvided?: true;
    /** 利用可能になったら準備用の案内を非表示にする。 */
    hideNoteWhenAvailable?: true;
}

/** whisper 行のモデルサブ行の表示用サイズ（`tool-install.ts` の `WHISPER_MODEL_FILENAME` 実測サイズ）。 */
export const WHISPER_MODEL_SIZE_LABEL = '約574MB';

/**
 * 検知結果と分離した、UI に表示する案内の正本。
 * 自動導入は `src/node/tool-install.ts` のインストールエンジンが担当する。
 * 手動導入の案内もここに集約し、インストール結果と共有する。
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
    'speech-analyzer': {
        osProvided: true,
        hideNoteWhenAvailable: true,
        name: 'SpeechAnalyzer', badge: '推奨', purpose: 'この Mac で高速に文字起こしします。',
        sizeLabel: 'macOS に付属', note: SPEECH_ANALYZER_MANUAL_INSTALL_GUIDANCE
    },
    'xcode-clt': {
        hideNoteWhenAvailable: true,
        name: 'macOS: Command Line Tools', badge: '推奨', purpose: 'プロジェクトの履歴・差分・スナップショットと、AI 分析の高速文字起こし・目線バー・指フレーム・人物マットに使います。',
        sizeLabel: '約 2GB',
        note: '入れなくても動画は作れます。導入後に自動で有効になり、履歴機能と AI 分析機能で使われます。'
    }
};
