// task/2026-09-02-shell-frame-engine-alpha-intake: frame-engine 面でアルファ取り込み（media-bin
// alpha-intake）の候補になる layer src の判定。Web UI（packages/preview-server → media-bin
// prepareAlphaLayers の ALPHA_CONTAINER_PATTERN）と同じく拡張子 .webm / .mov だけを候補にし、
// 不透明かどうかの最終判定は media-bin 側の ffprobe（alpha_mode / yuva pix_fmt）に委ねる。
// ブラウザ側の open-handler は Theia の DOM 依存で node:test から読み込めないため、判定だけを
// ここへ切り出して直接テストする（common/video-proxy-resolution.ts と同じ流儀）。

export const ALPHA_INTAKE_SOURCE_PATTERN = /\.(webm|mov)$/i;

/** layers[].src（edit.json の宣言値・拡張子付き）が alpha-intake の候補かどうか。 */
export function isAlphaIntakeSource(src: string | undefined): boolean {
    return typeof src === 'string' && ALPHA_INTAKE_SOURCE_PATTERN.test(src);
}
