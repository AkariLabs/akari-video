**English** | [日本語](./review-and-fix.ja.md)

# QA, review, and fix

The loop of checking and review is what makes "nearly finished when you open it" work.
Three skills work together: `edit-lint` (mechanical checks) → `compile-review-session`
(turns spoken review into tickets) → `address-review` (resolves tickets).

## Self-check — `edit-lint`

**When to use**: Right after creating or changing `edit.json`. Before export. To re-check
after addressing review tickets.

**How to ask**: "run lint" / "check it before I export"

**What it does**:

1. A deterministic CLI checks `edit.json`, `captions.json`, `analysis.json`, and the media
   assets themselves (broken references, time inconsistencies, overlaps, duration
   mismatches, etc.)
2. After PASS, the agent **actually looks at** keyframes to confirm quality

**What it produces**:

- `.akari/lint.json` — the canonical check result (`verdict: pass / fail`)
- `.akari/reports/edit-lint-report.html` — a human-readable report

On FAIL, the report shows counts and reasons. You can ask "fix the lint failures" to have
them addressed. render-cut requires lint PASS as a precondition, so this gate can't be
skipped.

## Review while talking through it — `compile-review-session`

**When to use**: When you want to call out issues out loud while watching the preview.

Hand over a recorded review session (audio + interaction events + snapshots) and it:

1. Transcribes it → segments the utterances
2. Resolves deictic references like "here" or "this caption" to their **actual targets**
   using playback position and interaction events
3. Normalizes them into imperative form and lands them as open tickets (annotations) in
   `review.json`

**How to ask**: "turn that review session into tickets"

## Address tickets — `address-review`

**When to use**: When `review.json` has open tickets piling up.

**How to ask**: "address a-0002 and a-0003" / "address all open tickets"

For each ticket, it makes the actual fix in `edit.json` → re-checks with edit-lint →
updates the ticket from `open` to `addressed`, following the same routine every time.
State transitions are recorded atomically, so it's always clear what's been addressed.

## About review persistence

Annotations aren't stored as "seconds on the timeline" but as **(asset, source timestamp
within the asset)**. Reordering cuts doesn't shift what a ticket points to.

## Next steps

- Once everything passes → [Export](./export.md)
