import { getLanguage, t } from '../../i18n/index.mjs';

export function renderPreviewIndex(html) {
  const messages = { longGop: t('render.frameEngine.warning.longGop', {}, getLanguage()) };
  const serialized = JSON.stringify(messages).replaceAll('<', '\\u003c');
  return html.replace('<!-- AKARI_PREVIEW_MESSAGES -->',
    `<script>window.__AKARI_PREVIEW_MESSAGES__=${serialized};</script>`);
}
