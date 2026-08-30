export const MANAGED_CAPTION_STYLE_VARIABLES = Object.freeze([
  '--caption-color',
  '--caption-font-size',
  '--caption-font-weight',
  '--caption-line-height',
  '--caption-text-shadow',
  '--caption-webkit-text-stroke',
  '--caption-paint-order',
  '--caption-top',
  '--caption-bottom',
  '--caption-translate',
  '--caption-left',
  '--caption-right',
  '--caption-width',
  '--caption-justify-content',
  '--caption-align-items',
  '--caption-line-margin',
  '--caption-line-max-width',
  '--caption-text-align',
  '--plate-bg',
  '--plate-radius',
  '--plate-block-bg',
  '--plate-block-radius',
]);

/** Replace the complete managed variable set so style from the prior cue cannot leak. */
export function replaceCaptionStyleVariables(style, values = {}) {
  for (const name of MANAGED_CAPTION_STYLE_VARIABLES) style.removeProperty(name);
  for (const [name, value] of Object.entries(values)) style.setProperty(name, String(value));
}
