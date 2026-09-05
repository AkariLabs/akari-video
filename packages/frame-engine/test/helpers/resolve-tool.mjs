import { existsSync } from 'node:fs';
import path from 'node:path';

/** Resolve test tools without depending on a platform-specific shell. */
export function resolveTool(name, options = {}) {
  const { platform = process.platform, env = process.env, exists = existsSync } = options;
  const variable = `AKARI_TOOL_${name.toUpperCase()}`;
  if (env[variable]) return env[variable];
  const homebrew = `/opt/homebrew/bin/${name}`;
  if (exists(homebrew)) return homebrew;

  // Use the injected platform's delimiter so Windows can also be tested on POSIX.
  const delimiter = platform === 'win32' ? path.win32.delimiter : path.posix.delimiter;
  const extensions = platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [];
  for (const directory of (env.PATH || '').split(delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory.replace(/^"(.*)"$/, '$1'), name);
    if (exists(candidate)) return candidate;
    for (const extension of extensions) {
      if (extension && exists(candidate + extension)) return candidate + extension;
    }
  }
  throw new Error(`${name} が見つかりません（PATH または ${variable} を設定してください）`);
}
