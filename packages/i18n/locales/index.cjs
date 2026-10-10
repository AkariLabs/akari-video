// 生成物・手で編集しない。
'use strict';

module.exports = {
  ja: {
    ...require("./ja/common.json"),
    ...require("./ja/decision-log.json"),
    ...require("./ja/report-analysis.json"),
    ...require("./ja/report-cards.json"),
    ...require("./ja/report-decision.json"),
    ...require("./ja/report-project.json"),
    ...require("./ja/settings.json"),
  },
  en: {
    ...require("./en/common.json"),
    ...require("./en/decision-log.json"),
    ...require("./en/report-analysis.json"),
    ...require("./en/report-cards.json"),
    ...require("./en/report-decision.json"),
    ...require("./en/report-project.json"),
    ...require("./en/settings.json"),
  },
};
