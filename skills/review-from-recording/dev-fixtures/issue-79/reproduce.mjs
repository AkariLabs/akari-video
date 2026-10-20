import { runFixture } from '../../test/helpers/issue-79-fixture.mjs';

for (const [name, options] of [
  ['BEFORE', { before: true }], ['AFTER', {}],
  ['UNKNOWN', { unknown: true }], ['BAD_TYPE', { badType: true }],
]) {
  const outcome = await runFixture(options);
  process.stdout.write(`${name}: ${JSON.stringify({ status: outcome.result.status, reason: outcome.result.reason, snapshotWarning: outcome.report.match(/edit\.snapshot\.json の未定義キーを無視しました: [^\n]+/u)?.[0] ?? null, snapshotUnchanged: outcome.snapshotUnchanged })}\n`);
}
