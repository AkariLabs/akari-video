const IMAGE_LAYER_SOURCE_PATTERN = /\.(?:png|jpe?g|webp|bmp|gif)$/iu;

export function isImageLayerSource(path) {
  return typeof path === "string" && IMAGE_LAYER_SOURCE_PATTERN.test(path);
}
