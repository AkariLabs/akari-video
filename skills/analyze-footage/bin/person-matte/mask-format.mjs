export const MASK_FORMAT = "gray-h264-fullrange";
export const MASK_CRF = 6;

export function maskOutputArguments({ fps, output }) {
  const gop = Math.max(1, Math.round(Number(fps)));
  return [
    "-an",
    "-vf", "alphaextract,format=gray",
    "-c:v", "libx264",
    "-profile:v", "high",
    "-pix_fmt", "yuv420p",
    "-color_range", "pc",
    "-colorspace", "bt709",
    "-color_primaries", "bt709",
    "-color_trc", "bt709",
    "-g", String(gop),
    "-keyint_min", String(gop),
    "-sc_threshold", "0",
    "-crf", String(MASK_CRF),
    "-preset", "medium",
    "-bf", "0",
    "-movflags", "+faststart",
    "-y", output,
  ];
}
