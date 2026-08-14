export function computeMouthTransitions(mouthStates, transitionFrames) {
  if (transitionFrames <= 0) return null;
  const transitions = Array(mouthStates.length).fill(null);
  for (let index = 1; index < mouthStates.length; index += 1) {
    if (mouthStates[index] === mouthStates[index - 1]) continue;
    for (let offset = 0; offset < transitionFrames && index + offset < mouthStates.length; offset += 1) {
      transitions[index + offset] = {
        from: mouthStates[index - 1],
        to: mouthStates[index],
        t: (offset + 1) / (transitionFrames + 1),
      };
    }
  }
  return transitions;
}

export function blendFrameBuffers(bufferA, bufferB, t) {
  if (bufferA.length !== bufferB.length) throw new Error("ブレンド対象の Buffer 長が一致しません");
  const output = Buffer.alloc(bufferA.length);
  for (let index = 0; index < bufferA.length; index += 1) {
    output[index] = Math.round(bufferA[index] + (bufferB[index] - bufferA[index]) * t);
  }
  return output;
}
