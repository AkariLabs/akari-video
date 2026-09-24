const ALLOWED_COMMERCIAL = new Set(['allowed', 'prohibited', 'unknown']);
const KNOWN_FREE = new Set([
  'CC0-1.0', 'LicenseRef-AKARI-Assets-v0', 'LicenseRef-AKARI-Sounds-Terms-v0',
  'MIT', 'OFL-1.1',
]);

/** Derive the two independent questions without rewriting older metadata. */
export function deriveLicenseAxes(license) {
  if (!license || typeof license !== 'object') {
    return { commercial: 'unknown', attributionRequired: null };
  }
  const spdx = typeof license.spdx === 'string' ? license.spdx.trim() : '';
  const scope = typeof license.scope === 'string' ? license.scope.trim().toLowerCase() : '';
  let commercial = 'unknown';
  let attributionRequired = null;

  if (KNOWN_FREE.has(spdx)) {
    commercial = 'allowed';
    attributionRequired = false;
  } else if (/^CC-BY(?:-[A-Z]+)*-\d+(?:\.\d+)?$/i.test(spdx)) {
    commercial = /(?:^|-)NC(?:-|$)/i.test(spdx) ? 'prohibited' : 'allowed';
    attributionRequired = true;
  } else if (/^CC-BY-NC(?:-|$)/i.test(spdx)) {
    commercial = 'prohibited';
    attributionRequired = true;
  }

  if (scope === 'commercial-ok' || scope === 'attribution') commercial = 'allowed';
  if (scope === 'non-commercial') commercial = 'prohibited';
  if (/(?:^|-)NC(?:-|$)/i.test(spdx)) commercial = 'prohibited';
  if (scope === 'attribution') attributionRequired = true;
  if (typeof license.attribution_required === 'boolean') {
    attributionRequired = license.attribution_required;
  }
  if (/^CC-BY(?:-[A-Z]+)*-\d+(?:\.\d+)?$/i.test(spdx)) attributionRequired = true;
  if (ALLOWED_COMMERCIAL.has(license.commercial)) commercial = license.commercial;
  if (typeof license.attributionRequired === 'boolean' || license.attributionRequired === null) {
    attributionRequired = license.attributionRequired;
  }
  return { commercial, attributionRequired };
}
