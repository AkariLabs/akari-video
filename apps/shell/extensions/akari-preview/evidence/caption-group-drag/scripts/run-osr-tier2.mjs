// wrapper-authored verification script: force OSR tier 2 (npm electron in the given repo)
// so BEFORE/AFTER compare the repository under test, not the installed desktop app.
const [, , repoRoot, projectRoot, outPath] = process.argv;
const { exportWithOsr } = await import(`${repoRoot}/packages/osr-export/src/index.mjs`);
const { resolveElectronLauncher } = await import(`${repoRoot}/packages/osr-export/src/runner.mjs`);
const result = await exportWithOsr({
  projectRoot, out: outPath,
  fps: 30, width: 1920, height: 1080, duration: 1.5, quality: 'high', encoder: 'auto',
  soft: true, verify: 'off',
  launcherResolver: options => resolveElectronLauncher({ ...options, allowDesktop: false })
});
const { writeFileSync } = await import('node:fs');
writeFileSync(`${outPath}.summary.json`, JSON.stringify({
  fellBackToLegacy: result.fellBackToLegacy,
  tier: result.launcher?.tier,
  reason: result.launcher?.reason,
  executable: result.launcher?.executable?.replace(repoRoot, '<repo>'),
  receipt: result.receipt
}, null, 2) + '\n');
if (result.fellBackToLegacy) process.exit(3);
