/** Select the send side without changing the draft or retaining its selector. */
export function resolveSendSide(inputs = {}) {
  const { frames_or_refs: selection, ...selectedInputs } = inputs;
  let side = null;
  if (selection === 'references') {
    side = 'references';
    selectedInputs.first_frame = null;
    selectedInputs.last_frame = null;
  } else if (selection === 'frames') {
    side = 'frames';
    selectedInputs.reference_images = [];
    selectedInputs.reference_videos = [];
    selectedInputs.reference_audios = [];
  }
  return { inputs: selectedInputs, side };
}
