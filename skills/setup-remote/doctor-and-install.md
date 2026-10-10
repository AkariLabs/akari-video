# Doctor assessment, installation, and login (handing off human actions)

## 1. Run doctor

```
node skills/setup-remote/bin/doctor.mjs
```

Read-only; does not change network settings. Branch on JSON `state`:

| state | Meaning | Next action |
|---|---|---|
| `not-installed` | Tailscale executable not found | §2 installation guide |
| `app-not-running` | Executable exists but CLI does not respond (typically app not running or initial setup incomplete) | Start app (`open -a Tailscale`) → §3 login → rerun doctor |
| `needs-login` | Installed but not logged in | §3 login |
| `stopped` | Logged in, connection off | Ask the user to turn on connection in Tailscale → rerun doctor |
| `running` | Connected | §4 phone checks |

## 2. Installation guide (human action — hard rule 3)

The agent does not perform this action. Present OS-specific steps; after the user reports completion, rerun doctor to verify.

- **macOS** (either):
  - App Store version (GUI, beginner-friendly): Search for “Tailscale” in the App Store and install.
  - Homebrew: `brew install --cask tailscale-app` — **the .pkg installer interactively requests the sudo password**,
    so the agent's shell cannot complete it. Ask the user to run it in their own terminal
    (in a Claude Code session, suggest `! brew install --cask tailscale-app`).
- **Windows**: `winget install Tailscale.Tailscale` or the official installer
  (https://tailscale.com/download/windows).
- **Linux**: Official script (https://tailscale.com/download/linux). Requiring `sudo` likewise makes this a human action.

## 3. Login (human action)

- Start Tailscale → log in with Google / GitHub / Apple, etc.
  (This account is the key to the tailnet, the private network. The free tier suffices for personal use.)
- Rerun doctor and verify `state: running`.

## 4. Phone (human action)

- Install “Tailscale” from App Store / Google Play; log in with **the same account as the PC**.
- Approve VPN configuration permission. Recommend “Always on”: links will not open when phone-side Tailscale
  is off, the main pitfall. Explicitly explain this to the user here.
- Once verified, continue to [serve-preview.md](serve-preview.md).
