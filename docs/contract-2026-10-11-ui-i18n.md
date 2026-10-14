# UI internationalization contract

Application text lives in `packages/i18n/locales/<language>/<namespace>.json`. Each catalog is a flat JSON object. Supported languages are `ja` and `en`; both catalogs have the same keys. Use keys of the form `<namespace>.<screen-or-feature>.<component>.<role>`, with lower-case English words separated by dots (the namespace segment may contain hyphens, e.g. `report-analysis`, `annotations-common`). Keys remain stable when the wording changes. Put only the key in application code: `t('settings.appearance.language.auto')`.

Messages use named placeholders such as `{name}`. Plurals use `_one` and `_other`; Japanese selects `_other` at runtime, and both language catalogs store both variants for a matching key set. A missing translation falls back to English, then to the key; development builds warn about missing keys.

The setting `akari.ui.language` accepts `auto`, `ja`, or `en`. An explicit language wins. When it is `auto` or absent, the browser reads Theia's saved `localeId` from localStorage next; Electron's preload refreshes that value from the OS language on every `auto` start. If no saved value exists, `AKARI_LANG`, the OS language, and finally English provide the fallback. Any OS language beginning with `ja` selects Japanese; all others select English. In Electron, the preload writes `localeId` before the frontend evaluates `nls.locale`, and sets `<html lang>` immediately or at `DOMContentLoaded` when the document element is not yet available. The settings dialog changes `localeId` through `nls.setLocale()` and reloads the window.

AKARI does not register `ja` as a Theia language pack. When `localeId` is `ja`, Theia's preload resets its locale to the default because the bundled Japanese translations are not a language pack; Theia's standard UI stays in English for Japanese users. `packages/i18n` still reads the stored `localeId` or explicit setting, so AKARI text stays Japanese. Translating Theia's standard UI requires a separate future decision.

Use `formatDate`, `formatNumber`, `formatCurrency`, and `compareText` from `@akari-video/i18n` for UI formatting. Japanese currency keeps the existing dollar estimate and fixed 150-yen approximation; English currency displays dollars only, with zero shown as `Free`. Work content and footage language are separate from UI language.

Run `npm run lint:i18n`. The checker compares Japanese source-line counts against `scripts/ci/i18n-baseline.json` and rejects increases, checks catalog keys and placeholders, and verifies static `t('key')` references. Lower counts are reported so the baseline can be reduced. Tests and comments are outside the line count.

Tests that assert Japanese UI text or formatting must call `setLanguage('ja')` and restore `setLanguage(undefined)` so their results do not depend on the host OS locale.
