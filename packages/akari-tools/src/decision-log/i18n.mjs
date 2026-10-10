import { readFileSync } from "node:fs";
import { getLanguage } from "../../../i18n/index.mjs";

const catalogs = {
  ja: JSON.parse(readFileSync(new URL("../../../i18n/locales/ja/decision-log.json", import.meta.url), "utf8")),
  en: JSON.parse(readFileSync(new URL("../../../i18n/locales/en/decision-log.json", import.meta.url), "utf8")),
};

export { getLanguage };

export function t(key, params = {}, language = getLanguage()) {
  const value = catalogs[language]?.[key] ?? catalogs.en[key];
  if (value === undefined) throw new Error(`Missing decision-log translation: ${key}`);
  return value.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/gu, (match, name) => params[name] === undefined ? match : String(params[name]));
}
