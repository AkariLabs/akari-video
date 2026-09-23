import { generateCliImage } from './agy-image.mjs';

export async function generateGrokImage(options) {
  return generateCliImage({ ...options, route: 'grok' });
}
