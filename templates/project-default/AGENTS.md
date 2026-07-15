# AKARI Video project instructions

- Keep canonical directories named `assets`, `planning`, and `exports`.
- Treat `.akari/workflow.json` and sidecars as product contracts; update them atomically.
- Put source media in `assets/`, human-readable work products in `planning/`, and deliverables in `exports/`.
- Record workflow gates by writing one immutable JSON file per event under `.akari/events/`.
- Do not edit or remove an existing event file after it has landed.
