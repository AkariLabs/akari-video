import { resolveCaptionDisplay } from '../../edit-store/lib/index.js';

/** Resolve API payloads in Node. Browser clients only receive completed timeline cues. */
export function resolveCaptionApiPayload(captionsRoot, editRoot, options = {}) {
  if (Array.isArray(captionsRoot) || !captionsRoot || typeof captionsRoot !== 'object'
      || captionsRoot.display_policy === undefined) {
    return captionsRoot;
  }
  if (!editRoot || typeof editRoot !== 'object') {
    throw new Error('edit.json is required to resolve caption display policy');
  }
  const resolved = resolveCaptionDisplay(captionsRoot, editRoot, {
    output: editRoot.output,
    extra_protected_terms: options.extra_protected_terms,
  });
  return { ...resolved, captions: resolved.display_cues };
}
