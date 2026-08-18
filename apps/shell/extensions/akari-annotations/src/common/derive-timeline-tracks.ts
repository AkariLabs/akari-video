// packages/edit-lint/src/derive-tracks.mjs の写し（契約 2026-07-24-r5b-track-ui のファイル境界により
// tsconfig rootDir 制約で import 不可のため契約逸脱として複製。正本は packages/edit-lint 側。
// アルゴリズムを変更する場合は両ファイルを同期させること。
//
// R6c（2026-07-25、複数音声トラック化）で以下 2 点を正本から意図的に分岐させている
// （内部 r6c1-audio-tracks-ui タスクの report に申し送り記載。R5-B の
// DEFAULT_GROUP_ORDER 是正と同種の先例）:
//   1. DEFAULT_GROUP_ORDER の audio 位置: 正本は末尾（最上段）だが、R6 契約 §1 裁定 1
//      「音源グループは最下段固定」を満たすため先頭（reverse 後に最下段）へ変更。
//   2. audio の導出を cuts/layers/overlays と同じ collectTrackNumbers 方式に変更
//      （正本は sfx の有無だけを見て常に ref 0 単一トラックを導出する）。
//
// 意図的分岐 4（2026-08-12、字幕レーンの表示条件を captions.json 基準へ）: 正本は edit.json
// 単体しか見ないため inline captions[] の有無だけを判定する。widget は字幕の正本である
// captions.json を別ファイルとして読むため、deriveTracks/deriveDefaultTimelineTracks は
// 呼び出し側が captions.json の非空を検知した結果（hasCaptions）を受け取れるよう引数を追加した
// （省略時 false = 正本と同じ inline 判定のみ、後方互換）。あわせて本ファイルには、正本に対応物が
// 無い widget 専用の表示専用ヘルパー（withCaptionsDisplaySupplement・computeTrackAutoNames）も
// 置く。いずれも edit.json への書き戻しは行わない。

import { EditTimelineTrack } from './edit-store';

const DEFAULT_GROUP_ORDER: ReadonlyArray<EditTimelineTrack['kind']> =
    ['audio', 'cuts', 'layers', 'overlays', 'captions'];

export function deriveTracks(edit: unknown, hasCaptions = false): EditTimelineTrack[] {
    const derived: EditTimelineTrack[] = [];
    const append = (kind: EditTimelineTrack['kind'], ref?: number): void => {
        derived.push({ id: `t${derived.length + 1}`, kind, ...(ref === undefined ? {} : { ref }) });
    };
    const value = isRecord(edit) ? edit : undefined;
    for (const kind of ['cuts', 'layers', 'overlays'] as const) {
        for (const track of collectTrackNumbers(value?.[kind])) {
            append(kind, track);
        }
    }
    const inlineCaptionsPresent = Array.isArray(value?.captions) && value.captions.length > 0;
    if (hasCaptions || inlineCaptionsPresent) {
        append('captions');
    }
    const audio = isRecord(value?.audio) ? value.audio : undefined;
    const audioTracks = new Set(collectTrackNumbers(audio?.sfx));
    // 意図的分岐 3（Phase 2-5 narration 逆輸入・2026-08-02）: narration は track を持たず
    // 常に ref 0 帯へ表示するため、narration だけのプロジェクトでも audio トラックを導出する
    // （表示専用の導出であり edit.json は変更しない）。
    if (Array.isArray(audio?.narration) && audio.narration.length > 0) {
        audioTracks.add(0);
    }
    // 意図的分岐 5（2026-08-18 実機報告: BGM が鳴るのにタイムラインに出ない）: bgm も track を
    // 持たず常に ref 0 帯へ表示するため（calculateLaneLayout の既存 bgm 区間描画）、bgm だけの
    // プロジェクトでも audio トラックを導出する（narration の分岐 3 と同型・表示専用）。
    if (isRecord(audio?.bgm)) {
        audioTracks.add(0);
    }
    for (const track of [...audioTracks].sort((left, right) => left - right)) {
        append('audio', track);
    }
    return derived;
}

/**
 * 表示専用の音声レーン補完（2026-08-18、字幕補完〔司令塔裁定 2026-08-12・裁定 2〕と同型）:
 * 明示 timeline.tracks に audio 種別が 1 つも無くても、audio.bgm が宣言されていれば表示上のみ
 * 最下段（配列先頭 = widget の「配列先頭 = 画面最下段」規約。音源グループは最下段固定〔R6 契約
 * §1 裁定 1〕）へ補う。既に audio 種別が（hidden: true でも）存在する場合は補わない — それが
 * ユーザーの「意図的に隠す」口だから。edit.json への書き戻しは行わない純関数。
 */
export function withAudioDisplaySupplement(
    tracks: readonly EditTimelineTrack[], hasBgm: boolean
): EditTimelineTrack[] {
    if (!hasBgm || tracks.some(track => track.kind === 'audio')) {
        return [...tracks];
    }
    return [{ id: 't-audio-implied', kind: 'audio', ref: 0 }, ...tracks];
}

/**
 * 導出トラック列を既定のグループ順（音源グループが最下段 = 配列先頭）へ並べ替える。
 * 導出そのもの（どの行が生えるか）は読み込み層（packages/edit-store の internal-model）が持ち、
 * ここは**表示順の規約だけ**を担う。
 */
export function sortDefaultTimelineTracks(tracks: readonly EditTimelineTrack[]): EditTimelineTrack[] {
    const priority = new Map(DEFAULT_GROUP_ORDER.map((kind, index) => [kind, index]));
    return tracks
        .map((track, index) => ({ track, index }))
        .sort((left, right) =>
            (priority.get(left.track.kind) ?? 0) - (priority.get(right.track.kind) ?? 0)
            || left.index - right.index)
        .map(entry => entry.track);
}

export function deriveDefaultTimelineTracks(value: unknown, hasCaptions = false): EditTimelineTrack[] {
    return sortDefaultTimelineTracks(deriveTracks(value, hasCaptions));
}

/**
 * 表示専用の字幕レーン補完（司令塔裁定 2026-08-12・裁定 2）。明示 timeline.tracks に captions
 * 種別が 1 つも無くても、captions.json に字幕があれば表示上のみ最上段（配列末尾 = widget の
 * `[...tracks].reverse()` 規約で画面最上段）へ補う。既に captions 種別が（hidden: true でも）
 * 存在する場合は補わない — それがユーザーの「意図的に隠す」口だから。edit.json への書き戻しは
 * 呼び出し側（widget の displayTimelineTracks）の責務であり、本関数は純関数として何も書き込まない。
 */
export function withCaptionsDisplaySupplement(
    tracks: readonly EditTimelineTrack[], hasCaptions: boolean
): EditTimelineTrack[] {
    if (!hasCaptions || tracks.some(track => track.kind === 'captions')) {
        return [...tracks];
    }
    return [...tracks, { id: 't-captions-implied', kind: 'captions' }];
}

/**
 * R7-4・A/V/T 命名（2026-08-12、字幕レーンの自動命名を V 系から T 系へ分離）: トラック表示名を
 * グループ内連番 + 種別プレフィックスへ（音声 = A1, A2, …・字幕 = T1, T2, …・映像系
 * （cuts/layers/overlays）= V1, V2, …。いずれも最下段から連番）。引数の tracks は widget の
 * displayTimelineTracks 規約（配列先頭 = 画面最下段）に従うこと。
 */
export function computeTrackAutoNames(tracks: readonly EditTimelineTrack[]): Map<string, string> {
    const names = new Map<string, string>();
    let audioCount = 0;
    let captionsCount = 0;
    let videoCount = 0;
    for (const track of tracks) {
        if (track.kind === 'audio') {
            audioCount++;
            names.set(track.id, `A${audioCount}`);
        } else if (track.kind === 'captions') {
            captionsCount++;
            names.set(track.id, `T${captionsCount}`);
        } else {
            videoCount++;
            names.set(track.id, `V${videoCount}`);
        }
    }
    return names;
}

function collectTrackNumbers(items: unknown): number[] {
    if (!Array.isArray(items)) {
        return [];
    }
    const tracks = new Set<number>();
    for (const item of items) {
        if (!isRecord(item)) {
            continue;
        }
        if (!Object.prototype.hasOwnProperty.call(item, 'track')) {
            tracks.add(0);
        } else if (Number.isInteger(item.track) && (item.track as number) >= 0) {
            tracks.add(item.track as number);
        }
    }
    return [...tracks].sort((left, right) => left - right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
