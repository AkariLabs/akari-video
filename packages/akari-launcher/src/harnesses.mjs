/** @typedef {'default' | 'claude' | 'opencode' | 'cursor' | 'codex'} HarnessId */

export const HARNESS_FLAG_ALIASES = {
  opencode: ['--opencode'],
  claude: ['--claude', '--claudecode'],
  cursor: ['--cursor'],
  codex: ['--codex'],
};

const HARNESS_FLAG_TO_ID = Object.fromEntries(
  Object.entries(HARNESS_FLAG_ALIASES).flatMap(([id, flags]) => flags.map((flag) => [flag, id])),
);

/**
 * @param {string[]} args
 * @returns {{ harness: HarnessId, filteredArgs: string[], autoConfirm: boolean }}
 */
export function parseHarnessArgs(args) {
  /** @type {HarnessId} */
  let harness = 'default';
  const filteredArgs = [];
  let autoConfirm = false;

  for (const arg of args) {
    if (arg === '--yes' || arg === '-y') {
      autoConfirm = true;
      continue;
    }
    const explicit = HARNESS_FLAG_TO_ID[arg];
    if (explicit) {
      harness = explicit;
      continue;
    }
    filteredArgs.push(arg);
  }

  return { harness, filteredArgs, autoConfirm };
}

/**
 * @param {HarnessId} harness
 * @param {boolean} autoConfirm
 * @param {string[]} filteredArgs
 */
export function buildHarnessArgv(harness, autoConfirm, filteredArgs) {
  switch (harness) {
    case 'opencode':
      return autoConfirm ? ['--auto', ...filteredArgs] : filteredArgs;
    case 'claude':
      return autoConfirm ? ['--permission-mode', 'acceptEdits', ...filteredArgs] : filteredArgs;
    case 'cursor':
      return autoConfirm ? ['--force', ...filteredArgs] : filteredArgs;
    case 'codex':
      // Codex CLI 0.144 系に --full-auto は無い。autoConfirm のマッピングは保留。
      return filteredArgs;
    default:
      return filteredArgs;
  }
}

export function harnessLaunchLabel(harness) {
  switch (harness) {
    case 'opencode': return 'opencode';
    case 'claude': return 'Claude Code';
    case 'cursor': return 'Cursor Agent';
    case 'codex': return 'Codex';
    default: return null;
  }
}
