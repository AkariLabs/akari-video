# Insert a person or character (avatar)

## Principle

Read avatar data in stages, as with CLAUDE.md / SKILL.md. **Do not read every avatar's full data for an insertion request such as "add Ryoma."** Routine insertion decisions use L0 (index) → L1 (AVATAR.md) only. Read L2 (`persona/` `voice/` `renditions/*/rendition.json`) only at the stages named under "Conditions for deeper L2 reading" below. The [avatar registry contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-26-avatar-registry-v0.md) defines the data shape; this leaf defines **how to read it and ask questions** during insertion.

## Trigger

Use when chat asks to insert a person, character, or avatar (for example, "add Ryoma" or "have Zundamon explain"). This leaf covers an existing registered avatar, not creating a character from scratch. New registration (voice sample → clone, importing character art, etc.) is out of scope; a registration wizard is a future stage.

## Procedure

### 1. L0 — Resolve the ID from INDEX

Read `avatars/INDEX.md` in this order and look for a one-line card matching the request (nearest first among the four scope layers; [contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-26-avatar-registry-v0.md) §1):

1. Project `.akari/avatars/INDEX.md`.
2. `~/.akari/avatars/INDEX.md` (personal scope, usually holding real-person avatars).
3. Public `catalog/avatars/INDEX.md` (`original` / `third_party` only).

If an ID exists in several layers, the nearer one wins (shadowing). If no ID matches, tell the human no matching avatar was found; leave later registration to a separate future skill.

### 2. L1 — Read only the matching AVATAR.md

Read **only** the resolved ID's `AVATAR.md`. Do not read another avatar's AVATAR.md, `persona/`, `voice/`, or `renditions/*/rendition.json`. Decide these points from L1 alone:

- Persona summary (first person, tone, speech style, leading prohibited content), injected into script-generation prompt context.
- Capability summary per rendition: `lipsync` / `expressions` / `framing`.
- `default_rendition` from `avatar.json`.

### 3. Resolve rendition

Inspect `default_rendition` in `avatar.json`, the machine-readable data referenced by L1:

| State | Action |
|---|---|
| `default_rendition` is non-null | Adopt it and only report the choice to the human; do not ask. |
| `default_rendition` is null with multiple rendition candidates | Ask which to insert using the **decision card** procedure (§4). |
| `default_rendition` is null but context uniquely narrows candidates to one under §3a | Select automatically and record evidence in `decision-log.md` (§6); do not ask. |

### 3a. Automatic selection rules (declared capabilities, S2 details)

Do not guess that context uniquely identifies a rendition. Apply these rules in order as **candidate filters** and select automatically only when exactly one remains. If several signals are present, apply **all** matching filters before counting (for example, a picture-in-picture explanation requiring lip sync uses both lipsync and framing filters).

| Context signal | Filter rule | Declaration checked |
|---|---|---|
| Lip sync required (avatar speaks voiced dialogue or narration) | Exclude renditions with `capabilities.lipsync !== true` | `renditions[].capabilities.lipsync` in `avatar.json` |
| Picture-in-picture insert (low screen-occupancy ratio, small in a corner) | Prefer renditions whose `capabilities.framing` includes `"bustup"`; exclude other-framing-only candidates | `renditions[].capabilities.framing` |
| Full shot (high screen-occupancy ratio, primary image) | Prefer renditions whose `capabilities.framing` includes `"fullbody"`; exclude other-framing-only candidates | `renditions[].capabilities.framing` |

- If **multiple candidates remain** after all filters, or **no context signal can be read**, ask via §4's decision card as before. Do not weaken this; auto-selection applies only when the answer is known.
- If **zero candidates** remain (for example, lip sync is required but none supports it), do not auto-select; explain the situation and ask via the decision card.
- Whether selecting automatically or through a question, **always** record one evidence row in `decision-log.md` (§6).

Worked example (assuming `ryoma`; `2d-bustup` / `2d-fullbody` both have `lipsync: true`):

```
文脈: 「口パク必須の解説シーンをワイプ挿入で使う」
1. lipsync フィルタ: 2d-bustup（lipsync: true）/ 2d-fullbody（lipsync: true）→ 両方残る
2. framing フィルタ（ワイプ→ bustup 優先）: 2d-bustup（framing: [bustup]）のみが該当 →
   2d-fullbody（framing: [fullbody]）を除外
3. 残り candidate = 1 件（2d-bustup）→ 自動選択
```

### 4. Decision card (multiple candidates and no default)

plan-edit does not use the generic HTML `data-card` mechanism for its own direction decisions ([report-guide.md](report-guide.md#generic-card-mechanism-specification-used-by-other-skills); it is for other skills such as plan-video). Avatar insertion is a decision within plan-edit execution, so **ask in chat** under the same rule: show recommendation, alternatives, benefits, drawbacks, and reasons, then obtain an explicit answer ([report-guide.md](report-guide.md#decide-direction-in-chat)). Do not leave the choice at "What would you like?" For each option, show rendition id, a preview (`preview.png` or an image in the rendition directory), and one line of capabilities.

Worked example (assuming `ryoma`, `default_rendition: null`, and two candidates):

```
質問: Ryoma をどれで入れますか？
- [2d-bustup]   バストアップ・口パク可（neutral/happy/sad/angry/surprised/laugh）
- [2d-fullbody] 全身・口パク可（neutral/happy/sad/angry/surprised/laugh）
推奨: 2d-bustup（ワイプ挿入で画面占有率が低いシーンのため。フルショットなら 2d-fullbody を推奨）
```

Choose the recommendation (AI default) from scene context, for example bust-up for a small picture-in-picture insert or full-body for a full shot, but require an explicit human answer to settle it.

### 5. Conditions for deeper L2 reading (only then)

Follow the conditions in internal contract §3 unchanged. Do not read these in routine work:

| Stage | File to read |
|---|---|
| Lip-sync prerender | Only `renditions/<id>/rendition.json` for the selected rendition |
| Dialogue script with multiple avatars | `persona/relationships.json`, only if present |
| Voice generation | `voice/voice.json` |

Treat `persona/persona.md` (full persona), if present, as L2 too. Otherwise the `persona` object in `avatar.json` (same content as L1) is the only source; there is no deeper file to read.

### 6. Record in `decision-log.md`

Append every rendition choice, whether reached through chat or automatically, with evidence in `decision-log.md` ([report-guide.md#decision_log](report-guide.md#decision_log)). Use the same granularity and file as asset selections in [expression-selection.md](expression-selection.md#evidence-record), adding one row in the `rendition` category:

```text
<avatar id> @ <timeline seconds> | category: rendition | subject: <avatar id>/<selected rendition id> |
Decision: <selected rendition id> | Reason: <one sentence> | Decided by: human|ai-auto | Related checkpoint: <checkpoint>
```

- **Write one row for auto-selection and rejection too**; neither decide nor drop silently, as in expression-selection.md's evidence rule.
- **For auto-selection (decider value `ai-auto`), the reason cell must name in one sentence which §3a filters applied.** For example, required lip sync plus picture-in-picture leaves only one bust-up, lip-sync-capable rendition. Do not write a vague reason such as "judged from context" without filter names; evidence must be auditable later.
- For a chat decision (decider value `human`), summarize the human's answer and confirmed choice in the reason cell.
- Implementation and automation of recording are in S2 scope. This leaf defines only what must be recorded.

### 6a. Propose promotion to `default_rendition` (added in S2)

If the same rendition was selected for the same avatar in the **latest three consecutive** `decision-log.md` rows with category `rendition` and `subject: <avatar id>/*` (no intervening choice of another rendition), **propose** promotion to `default_rendition` in chat. Deciders may be human or ai-auto. Do not write it on your own; write only after approval (internal contract §7-3).

1. **Detect**: Extract only `rendition` rows whose `subject` begins `<avatar id>/` from `decision-log.md` in time order. Starting at the end, check whether the decision column contains the same rendition id for three consecutive rows; if so, it qualifies for a promotion proposal.
2. **Compose the proposal** in chat, following report-guide.md's recommendation + reason + explicit-answer format:

   ```
   提案: <avatar id> の rendition は直近 3 回連続で `<rendition id>` が選ばれています。
   以後は質問せずこれを既定にしますか？（`avatar.json` の default_rendition へ書き込みます）
   ```

3. **Only after approval**, write the rendition id to `avatar.json` `default_rendition`. If rejected, do not write it; record one rejection row in `decision-log.md` under §6.
4. **Always run `validate-avatar.mjs` after writing** and confirm PASS (it detects a typo where `default_rendition` is absent from `renditions[]`).
5. After promotion, follow the first row of §3's table (non-null `default_rendition`) and adopt without asking thereafter.

## Connection to script generation (persona injection, S2 details)

When an avatar will speak a script or narration (after plan.json dialogue settles structure or while assigning avatar speech in an existing script), **inject the L1 persona summary (AVATAR.md / `avatar.json` `persona`) into the script-generation prompt context before generating text**.

### Fields to inject

Include these six fields from the `persona` object unchanged in script-generation instructions. Do not summarize or paraphrase registered values or embellish the voice into another style:

| Field | Use |
|---|---|
| `first_person` | Use this consistently as the first-person form in dialogue. |
| `tone` | Match the overall tone and warmth of delivery. |
| `speech_style` | Follow it for explanation detail and technical-term handling. |
| `verbal_tics` | Incorporate naturally into wording or sentence endings without overuse; apply the content-language pack (see SKILL.md). |
| `energy` | Match sentence length, tempo, and exclamation frequency to its level (0 = calm, 100 = highly animated). |
| `default_role` | Write for this role unless the scene explicitly assigns another. |

### Respect prohibited content (pre-generation check)

**Do not generate** script text touching topics or phrasings listed in `persona.ng`. Treat this as a **pre-generation procedure**, not post-generation lint: read `ng` before writing and structure the script to avoid those angles. If a violation is found after generation, rewrite immediately; do not show violating text in chat first and fix later.

### Connection to voice resolution

When the script is confirmed, resolve `voice` with the avatar as speaker under [skills/generate-narration/avatar-voice.md](../generate-narration/avatar-voice.md). Do not alter the existing `edit.json` contract: narration provenance `voice` simply receives the avatar's `voice.ref` (`speaker:3(...)` / `profile:owner-ja`, etc., the same reference-string form as the narration-tts contract). Do not invent fields.

## VOICEVOX preset proposal and registration (added in S2)

At an avatar-insertion stage, if the L0 scan (§1) finds **zero registered avatars** (or zero avatars with `voice`), mention the two fixed presets as available possibilities. Do not force a choice; the internal contract §1 and owner ruling say to mention them, not bundle them.

### Prerequisite

Propose these **only when VOICEVOX doctor reports `ok`** (the `voicevox` check in `skills/manage-connections/bin/doctor.mjs`, following the narration-tts contract and [engines.md](../generate-narration/engines.md); do not offer an unusable lane). If doctor is not `ok`, omit this proposal while continuing other insertion decisions normally.

### Proposal card (exactly two characters)

| id | display_name | Gender | Speaker (VOICEVOX Normal) | Source and credit conditions |
|---|---|---|---|---|
| `zundamon` | `ずんだもん` | Boy | id 3 | [zunko.jp voice-use terms](https://zunko.jp/con_ongen_kiyaku.html). Credit must say `VOICEVOX:ずんだもん` (uncredited commercial use costs ¥400,000 plus tax per character). |
| `shikoku-metan` | `四国めたん` | Woman | id 2 | Same terms (same project family and conditions). Credit must say `VOICEVOX:四国めたん`. |

Presentation template (show in chat as a low-pressure suggestion, never forcing a selection; render in the user's language under the language pack, see SKILL.md):

```
こういうのもあるよ: VOICEVOX の既製声プリセットが 2 体あります（ゼロ円・ローカル・数秒）。
- ずんだもん（男の子・id 3） — 出典/規約: zunko.jp（クレジット「VOICEVOX:ずんだもん」表記必須）
- 四国めたん（女性・id 2） — 出典/規約: zunko.jp（クレジット「VOICEVOX:四国めたん」表記必須）
選びますか？（選ばなくても続行できます）
```

### Registration (only if selected)

1. Create `~/.akari/avatars/<id>/` (personal scope). Do not put it in public `catalog/avatars/`; even third-party registration here uses only personal scope.
2. Create `avatar.json`:
   - `rights`: `{"subject": "third_party", "consent": "terms:https://zunko.jp/con_ongen_kiyaku.html", "credit_required": true, "distribution": "private"}`
   - `voice`: `{"lane": "voicevox", "ref": "speaker:<id>(<名前>/ノーマル)", "credit": "VOICEVOX:<名前>"}`
   - `renditions`: `[]` (voice-only, covered by the S2 schema relaxation in [docs/contract-2026-07-26-avatar-registry-v0.md](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-26-avatar-registry-v0.md) §13).
   - `default_rendition`: `null`
3. Create `AVATAR.md`: cite official character settings with source URLs and **do not embellish them**. Keep personality and traits as cited. Mark details not supported by sources, such as fine speech-style details, as "primary source unverified; owner confirmation needed." Add **one line stating the character choice itself is provisional pending owner ratification**.
4. Create `voice/voice.json` with `lane: "voicevox"`, `speaker id`, and `credit` (same as `avatar.json` `voice`, with L2 detail).
5. After registration, run `validate-avatar.mjs ~/.akari/avatars/<id>` and confirm **PASS**.
6. Append a one-line card to `~/.akari/avatars/INDEX.md` (L0).
