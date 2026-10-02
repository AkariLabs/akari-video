// F-50: akari-preview-open-handler.ts から機械移設したモジュール直下の const（宣言は無改変で `export` を足しただけ）。
import { Command } from '@theia/core/lib/common';
import type { EditSummary } from './preview-host-types';

export const PREVIEW_COLOR_KEYWORDS = new Set([
    'black', 'white', 'red', 'green', 'blue', 'yellow', 'cyan', 'magenta', 'gray', 'grey',
    'orange', 'purple', 'pink', 'brown'
]);
export const isPreviewColorLike = (value: string): boolean =>
    value.startsWith('#') || /^0x/iu.test(value) || PREVIEW_COLOR_KEYWORDS.has(value.toLowerCase());

export const CAPTION_ZONES = [
    'top-left', 'top', 'top-right',
    'left', 'center', 'right',
    'bottom-left', 'bottom', 'bottom-right'
] as const;

// akari-transcript の AKARI_TRANSCRIPT_SEEK_REQUESTED.id（akari-transcript-commands.ts）とミラー。
// cross-package import を避けるため文字列 ID のみで CommandRegistry.registerHandler に後付け登録する。
export const TRANSCRIPT_SEEK_COMMAND_ID = 'akari.transcript.seekRequested';
// プレビュー全画面（togglePreviewFullscreen）で widget.node に付ける CSS クラスと、
// そのスタイルを注入する <style> 要素の id。
export const PREVIEW_FULLSCREEN_CLASS = 'akari-preview-fullscreen';
export const PREVIEW_FULLSCREEN_ANCESTOR_CLASS = 'akari-preview-fullscreen-ancestor';
export const PREVIEW_FULLSCREEN_STYLE_ID = 'akari-preview-fullscreen-style';
// akari-annotations 側の PREVIEW_PLAYBACK_TICK_EVENT とミラー。
export const PREVIEW_PLAYBACK_TICK_EVENT = 'akari.preview.playbackTick';
// raw preview は editUri を持たないため、注釈パネルへ「現在フォーカス中の素材 URI + source 秒」を
// outer window の専用イベントで渡す。録音セッションの transport には合流させない。
export const RAW_PREVIEW_ANNOTATION_STATE_EVENT = 'akari.preview.rawAnnotationState';
export const TIMELINE_OVERLAY_SELECTED_EVENT = 'akari.timeline.overlaySelected';
export const CAPTION_ZONE_HOVER_EVENT = 'akari.caption.zoneHover';
export const CAPTION_ZONE_PRESET_EVENT = 'akari.caption.zonePreset';
// CF-select: overlay 選択同期チャンネルの layers 版（akari-annotations 側と文字列のみミラー）。
export const TIMELINE_LAYER_SELECTED_EVENT = 'akari.timeline.layerSelected';
// 書き込み完了の直接通知。edit-store の atomic rename 完了 → akari-annotations backend →
// AkariAnnotationsClientImpl（frontend）が撒く window イベントで、**file watcher より先に**着く。
// akari-preview は akari-annotations を import できない（annotations → preview の一方向依存で
// 逆は循環）ため、他の拡張間チャンネルと同じく文字列のみミラーする。
// **ミラー元は `akari-annotations/src/browser/akari-annotations-client.ts` の
// EDIT_STORE_DID_WRITE_EVENT。片方だけ変えると通知が届かなくなる。**
export const EDIT_STORE_DID_WRITE_EVENT = 'akari.editStore.didWrite';
// 直接通知で処理した書き込みを、後から来る watcher イベントで二重に処理しないための窓。
// akari-annotations 側の recentWrites（1 秒窓）と同型。
export const RECENT_WRITE_WINDOW_MS = 1000;
export const TIMELINE_SET_MUTED_EVENT = 'akari.timeline.setMuted';
export const TIMELINE_SET_TRACK_VISIBILITY_EVENT = 'akari.timeline.setTrackVisibility';
export const TIMELINE_SET_CAPTIONS_VISIBILITY_EVENT = 'akari.timeline.setCaptionsVisibility';
export const TIMELINE_SET_CLIPS_VISIBILITY_EVENT = 'akari.timeline.setClipsVisibility';
export const TIMELINE_SET_OVERLAY_TRACK_MUTED_EVENT = 'akari.timeline.setOverlayTrackMuted';
export const TIMELINE_SET_LAYERS_VISIBILITY_EVENT = 'akari.timeline.setLayersVisibility';
export const TIMELINE_SET_LAYERS_MUTED_EVENT = 'akari.timeline.setLayersMuted';
export const TIMELINE_SET_AUDIO_VISIBILITY_EVENT = 'akari.timeline.setAudioVisibility';
export const TIMELINE_SET_AUDIO_MUTED_EVENT = 'akari.timeline.setAudioMuted';
export const TIMELINE_SET_CAPTIONS_MUTED_EVENT = 'akari.timeline.setCaptionsMuted';
export const TIMELINE_SET_BEATS_VISIBILITY_EVENT = 'akari.timeline.setBeatsVisibility';
export const TIMELINE_SET_BEATS_MUTED_EVENT = 'akari.timeline.setBeatsMuted';
export const TIMELINE_SYNC_TRACK_TOGGLES_EVENT = 'akari.timeline.syncTrackToggles';
// akari-annotations 側の TIMELINE_LIVE_TRANSFORM_EVENT とミラー（文字列のみ、cross-package import なし）。
// インスペクターのスクラブドラッグ中、書き込みなしで cuts/layers の transform/opacity をプレビューへ
// 即時反映する ephemeral イベント。
export const TIMELINE_LIVE_TRANSFORM_EVENT = 'akari.timeline.liveTransform';
// akari-annotations 側とミラー（文字列のみ、cross-package import なし）。調整タブの A/B 比較で adjust を一時バイパスする。
export const TIMELINE_ADJUST_BYPASS_EVENT = 'akari.timeline.adjustBypass';
// akari-annotations 側とミラー（文字列のみ、cross-package import なし）。新規プレビューへ現在のバイパスを再送する。
export const PREVIEW_ADJUST_BYPASS_QUERY_EVENT = 'akari.preview.adjustBypassQuery';
export const TIMELINE_LOOP_RANGE_EVENT = 'akari.timeline.loopRange';
export const PREVIEW_OVERLAY_SELECTED_EVENT = 'akari.preview.overlaySelected';
export const PREVIEW_LAYER_SELECTED_EVENT = 'akari.preview.layerSelected';
// forwardOverlaySelection/forwardLayerSelection と同じ拡張間チャンネルの cut 版。
// payload は表示中 cut の安定 ID とし、タイムラインと inspector が同じ項目を引けるようにする。
export const PREVIEW_CUT_SELECTED_EVENT = 'akari.preview.cutSelected';
// ㉓ 字幕版。既存 2 チャンネルと同じ配線パターンをここに追加するだけ
// （タイムライン側〔akari-annotations、編集禁止〕の購読は対象外）。
export const PREVIEW_CAPTION_SELECTED_EVENT = 'akari.preview.captionSelected';
// akari-annotations の録音セクション側と文字列だけをミラーし、extension 間の npm 依存を作らない。
export const REVIEW_SESSION_START_EVENT = 'akari.review.session.start';
export const REVIEW_ANNOTATION_SHOW_STROKES_EVENT = 'akari.review.annotation.showStrokes';
export const REVIEW_SESSION_STOP_EVENT = 'akari.review.session.stop';
export const REVIEW_SESSION_REFRESH_EVENT = 'akari.review.session.refresh';
export const REVIEW_SESSION_OPEN_FOLDER_EVENT = 'akari.review.session.openFolder';
export const REVIEW_SESSION_STATE_EVENT = 'akari.review.session.state';
// akari-session-viewer-widget.ts の同名定数と文字列だけミラーする。
export const REVIEW_SESSION_VIEWER_SYNC_EVENT = 'akari.review.session.viewer.sync';
// M2 (task.md): 右パネルの選択/ペン/四角ボタンからの mode request。akari-annotations 側と
// 文字列だけミラーする（既存 5 定数と同じ配線パターン）。
export const REVIEW_TOOL_MODE_SET_EVENT = 'akari.review.toolMode.set';
// M3 (task.md 指示2): 注釈パネルの「選択を解除」導線からの request。同じミラー配線パターン。
export const REVIEW_UI_SELECTION_CLEAR_EVENT = 'akari.review.uiSelection.clear';

// akari-annotations の ATTACH_AKARI_ANNOTATIONS_PASSIVE.id（akari-annotations-commands.ts）とミラー。
// cross-package import を避けるため文字列 ID のみで CommandRegistry.executeCommand に渡す。
export const ATTACH_TIMELINE_PASSIVE_COMMAND_ID = 'akari.annotations.attachPassive';

// タイムライン操作時にアウトプットプレビューのタブを前面へ出すための内部コマンド。
// label なし = コマンドパレット非表示（ATTACH_AKARI_ANNOTATIONS_PASSIVE と同じパターン）。
export const ENSURE_PREVIEW_VISIBLE_COMMAND: Command = { id: 'akari.preview.ensureVisible' };
export const SEEK_OUTPUT_PREVIEW_COMMAND: Command = { id: 'akari.preview.seekOutput' };
export const CAPTURE_OUTPUT_PREVIEW_FRAME_COMMAND: Command = { id: 'akari.preview.captureFrame' };
export const TOGGLE_OUTPUT_PREVIEW_PLAYBACK_COMMAND: Command = { id: 'akari.preview.togglePlayback' };
export const COMPACT_TRACKS_COMMAND: Command = { id: 'akari.preview.compactTracks' };
export const ANNOTATE_PREVIEW_AT_POINT_COMMAND: Command = { id: 'akari.preview.annotateAtPoint' };
export const GROUP_PREVIEW_COMMAND: Command = { id: 'akari.preview.group' };
export const UNGROUP_PREVIEW_COMMAND: Command = { id: 'akari.preview.ungroup' };

export const SET_PREVIEW_FULLSCREEN_COMMAND: Command = { id: 'akari.preview.setFullscreen' };
export const SET_PREVIEW_VIEW_ZOOM_COMMAND: Command = { id: 'akari.preview.setViewZoom' };
export const SET_PREVIEW_PLAYBACK_RATE_COMMAND: Command = { id: 'akari.preview.setPlaybackRate' };
export const SET_PREVIEW_LOOP_RANGE_COMMAND: Command = { id: 'akari.preview.setLoopRange' };
export const PREVIEW_PLAY_COMMAND: Command = { id: 'akari.preview.play' };
export const PREVIEW_PAUSE_COMMAND: Command = { id: 'akari.preview.pause' };
export const PREVIEW_CROP_MODE_COMMAND: Command = { id: 'akari.preview.enterCropMode' };
export const PREVIEW_PERSPECTIVE_PANEL_COMMAND: Command = { id: 'akari.preview.openPerspectivePanel' };
export const PULSE_PREVIEW_ITEM_COMMAND: Command = { id: 'akari.preview.pulseItem' };
export const SHOW_PREVIEW_ZONE_HINT_COMMAND: Command = { id: 'akari.preview.showZoneHint' };
// akari-annotations の OPEN_AKARI_REVIEW_PANEL_ID とミラー（逆向き npm 依存を作らない）。
export const OPEN_AKARI_REVIEW_PANEL_COMMAND_ID = 'akari.review.open';
// akari-annotations の CLIP_ANNOTATION_REQUEST_EVENT とミラー（逆向き npm 依存を作らない）。
export const CLIP_ANNOTATION_REQUEST_EVENT = 'akari.review.clipAnnotation.request';
export const COMPACT_TRACKS_ACTION = '整理する';
export const KEEP_TRACKS_ACTION = '今はしない';
// task/2026-08-09-drop-hevc-proxy: withOpenTimeout はモデル読み込み・createVideoStream・
// setHTML だけを包む（webview 自体の起動・レンダリングは待たない — setHTML が返れば operation は
// 完了扱い）。resolveStreamVideoUri がもう resolveHevcProxy を呼ばなくなった今、この区間に
// メディアのデコードや変換は一切含まれない。実際の変換（handleHevcFallbackRequest 経由）は
// widget が開いた後、webview からの再生失敗通知に応じて別経路で走るため、この定数の対象外。
export const PREVIEW_OPEN_TIMEOUT_MS = 10_000;
export const PREVIEW_OPEN_ATTEMPTS = 2;
export const PREVIEW_OPEN_ERROR_MESSAGE = '動画プレビューを開けませんでした。しばらく待ってから、もう一度お試しください。';

export const EMPTY_SUMMARY: EditSummary = {
    output: { width: 1280, height: 720, fps: 30 },
    overlays: [],
    tree: [],
    layers: [],
    filters: [],
    cuts: [],
    indicators: []
};
// v0（単一 source）を v1 と同じ「id → ソース」表で扱うための既定 id。
// cuts[].src を持たない v0 のカットは全てこの id を指す。

// ドットディレクトリ（.git/.akari/.claude 等）と node_modules は名前探索の対象外。
// スキル同梱の開発用フィクスチャ（.claude/skills/**/dev-fixtures/）を拾わないための除外。
export const isSkippedSearchDirectory = (name: string): boolean => name.startsWith('.') || name === 'node_modules';
export const PLAYABLE_VIDEO_MIME_TYPES = new Map<string, string>([
    ['.mp4', 'video/mp4'],
    ['.mov', 'video/mp4'],
    ['.m4v', 'video/mp4'],
    ['.webm', 'video/webm']
]);
export const UNSUPPORTED_VIDEO_EXTENSIONS = new Set(['.mkv', '.avi', '.mts', '.m2ts', '.wmv']);
export const CLAIMED_VIDEO_EXTENSIONS = new Set([
    ...PLAYABLE_VIDEO_MIME_TYPES.keys(),
    ...UNSUPPORTED_VIDEO_EXTENSIONS
]);
export const UNSUPPORTED_FORMAT_MESSAGE = 'この形式はアプリ内プレビューに未対応です。書き出し後の MP4 をプレビューできます。';
export const OUTSIDE_WORKSPACE_MESSAGE = 'ワークスペース外の動画はプレビューできません。';
// 新規プロジェクトの edit.json は素材が入る前は空（`{}`）。project-scaffold が作成時点で
// 置くようになった（2026-08-08）ため、素材を入れる前に「編集データ」を開くのが通常の順序に
// なった。ソース未宣言は不正ではないので、エラーではなくこの案内を出す。
export const EMPTY_PROJECT_MESSAGE = 'まだ動画が入っていません。左の「素材」に動画をドラッグして取り込むと、ここで仕上がりを確認できます。';
export const LAYER_BLEND_TO_CSS = new Map<string, string>([
    ['normal', 'normal'],
    ['screen', 'screen'],
    ['multiply', 'multiply'],
    ['add', 'plus-lighter'],
    ['difference', 'difference'],
    ['darken', 'darken'],
    ['lighten', 'lighten'],
    ['overlay', 'overlay'],
    ['hardlight', 'hard-light'],
    ['softlight', 'soft-light']
]);

// GLB の extensionsUsed 検査で最初に読む長さ（readGltfHeaderBytes）。
export const GLTF_HEADER_PROBE_BYTES = 64 * 1024;
