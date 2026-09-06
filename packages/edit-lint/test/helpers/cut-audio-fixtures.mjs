import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const cutAudioFixtureNames = [
  'edit-v2-cut-audio-split-valid',
  'edit-v2-cut-audio-link-missing-invalid',
  'edit-v2-cut-audio-link-not-media-invalid',
  'edit-v2-cut-audio-link-duplicate-invalid',
];

export async function prepareCutAudioFixtures(root) {
  const examples = fileURLToPath(new URL('../../../schemas/examples/', import.meta.url));
  for (const name of cutAudioFixtureNames) {
    const project = join(root, name);
    await cp(join(examples, name), project, { recursive: true });
    await mkdir(join(project, 'assets'), { recursive: true });
    // Default lint checks file existence only; no media probe is requested here.
    await writeFile(join(project, 'assets/main.mp4'), 'fixture media placeholder\n');
  }
}
