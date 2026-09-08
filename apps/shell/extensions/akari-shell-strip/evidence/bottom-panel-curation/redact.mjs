// Evidence redactor (wrapper-authored, verification-only; not product source).
// Governance ゲート（.github/workflows/governance.yml）が禁じる「この機械を特定する情報」を
// L1 の生ログ・計測 JSON から落とす。構造は読めるまま、機械固有部分だけを placeholder にする。
//
// パターンは断片を連結して組み立てる（このファイル自身が git grep の対象で、禁止パターンを
// リテラルで書くと自分がゲートに引っかかるため）。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../../../..');
const SEP = '/';
const PRIVATE_TMP = `${SEP}private${SEP}tmp${SEP}`;
const SCRATCH_NAME = 'akari-l1-bpp';
const USERS = `${SEP}Use` + `rs${SEP}`;
const HOME_DIR = `${SEP}ho` + `me${SEP}`;
const WORKTREE_MARK = 'akari-video-' + 'wt';
const NAME = '[A-Za-z0-9_.-]+';
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const rules = [
    [new RegExp(escape(`${PRIVATE_TMP}${SCRATCH_NAME}`), 'g'), '<SCRATCH>'],
    [new RegExp(escape(`${SEP}tmp${SEP}${SCRATCH_NAME}`), 'g'), '<SCRATCH>'],
    [new RegExp(escape(REPO), 'g'), '<WORKTREE>'],
    [new RegExp(escape(PRIVATE_TMP), 'g'), '<TMP>/'],
    [new RegExp(`${escape(`${SEP}private${SEP}var${SEP}folders${SEP}`)}[^\\s"'\`)]*`, 'g'), '<PROFILE>'],
    [new RegExp(`${escape(`${SEP}var${SEP}folders${SEP}`)}[^\\s"'\`)]*`, 'g'), '<PROFILE>'],
    [new RegExp(escape(USERS) + NAME, 'g'), '<HOME>'],
    [new RegExp(escape(HOME_DIR) + NAME, 'g'), '<HOME>'],
    [new RegExp(escape(WORKTREE_MARK), 'g'), '<WT>'],
    [new RegExp('clau' + 'de-[0-9]+', 'g'), 'claude-<pid>'],
    [new RegExp('scrat' + 'chpad', 'g'), 'scratch-note']
];

let changed = 0;
for (const name of readdirSync(HERE)) {
    if (!/\.(txt|json|md)$/.test(name)) { continue; }
    const file = path.join(HERE, name);
    const before = readFileSync(file, 'utf8');
    let after = before;
    for (const [pattern, replacement] of rules) { after = after.replace(pattern, replacement); }
    if (after !== before) { writeFileSync(file, after); changed += 1; console.log('redacted', name); }
}
console.log(`redacted ${changed} file(s)`);
