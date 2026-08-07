export function findAlphaModeTag(tags) {
  return Object.entries(tags ?? {})
    .find(([key]) => key.toLowerCase() === "alpha_mode")?.[1];
}
