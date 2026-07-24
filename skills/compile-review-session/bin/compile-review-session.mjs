#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildProposals,
  chooseProposalDecision,
  proposalToAnnotation,
  segmentUtterances,
} from "./core/compiler.mjs";
import {
  appendAnnotationsAtomic,
  writeAtomic,
  writeJsonAtomic,
} from "./core/review-store.mjs";
import {
  buildCutMap,
  buildTimelineTrace,
  parseEventsJsonl,
} from "./core/time-mapping.mjs";
import { transcribeAudio } from "./core/transcription.mjs";

const USAGE = [
  "使い方:",
  "  node skills/compile-review-session/bin/compile-review-session.mjs <project-root>",
  "    [--session <s-XXXX>] [--force] [--allow-cloud-stt] [--json]",
  "    [--prepare-only | --apply-proposals]",
  "    [--cloud-provider <scribe|groq> --cloud-approved]",
].join("\n");

class CliError extends Error {}

function parseArguments(argv) {
  const options = {
    projectRoot: null,
    session: null,
    force: false,
    allowCloudStt: false,
    json: false,
    prepareOnly: false,
    applyProposals: false,
    cloudProvider: null,
    cloudApproved: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--force") options.force = true;
    else if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    }
    else if (argument === "--allow-cloud-stt") options.allowCloudStt = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--prepare-only") options.prepareOnly = true;
    else if (argument === "--apply-proposals") options.applyProposals = true;
    else if (argument === "--cloud-approved") options.cloudApproved = true;
    else if (argument === "--session" || argument === "--cloud-provider") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new CliError(`${argument} の値がありません`);
      if (argument === "--session") options.session = value;
      else options.cloudProvider = value;
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new CliError(`不明なオプションです: ${argument}`);
    } else if (options.projectRoot === null) {
      options.projectRoot = path.resolve(argument);
    } else {
      throw new CliError("project-root は 1 つだけ指定してください");
    }
  }
  if (!options.projectRoot) throw new CliError(USAGE);
  if (options.prepareOnly && options.applyProposals) {
    throw new CliError("--prepare-only と --apply-proposals は同時に指定できません");
  }
  if (options.session && !/^s-\d{4,}$/.test(options.session)) {
    throw new CliError("--session は s- + 4 桁以上の数字で指定してください");
  }
  if (options.cloudProvider && !["scribe", "groq"].includes(options.cloudProvider)) {
    throw new CliError("--cloud-provider は scribe または groq です");
  }
  if ((options.cloudProvider || options.cloudApproved) && !options.allowCloudStt) {
    throw new CliError("クラウド指定には --allow-cloud-stt が必要です");
  }
  if (options.cloudApproved && !options.cloudProvider) {
    throw new CliError("--cloud-approved には --cloud-provider が必要です");
  }
  return options;
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function relativeAudioPath(sessionId, audio) {
  return path.posix.join("review", "sessions", sessionId, String(audio).replaceAll("\\", "/"));
}

function ensureInside(parent, candidate, label) {
  const relative = path.relative(parent, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} がセッションディレクトリ外を指しています`);
  }
}

async function readJson(file, label) {
  let source;
  try {
    source = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      const notFound = new Error(`${label} がありません`);
      notFound.code = "ENOENT";
      throw notFound;
    }
    throw error;
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} が有効な JSON ではありません`);
  }
}

function validateTranscript(value) {
  if (!value || typeof value.backend !== "string" || !Array.isArray(value.segments)) {
    throw new Error("transcript.json の backend または segments が不正です");
  }
  for (const [index, segment] of value.segments.entries()) {
    if (
      !Number.isFinite(segment?.start)
      || !Number.isFinite(segment?.end)
      || segment.end <= segment.start
      || typeof segment?.text !== "string"
      || !Array.isArray(segment.words)
    ) {
      throw new Error(`transcript.json segments[${index}] が不正です`);
    }
    if (segment.words.length === 0 && segment.text.trim()) {
      throw new Error(`transcript.json segments[${index}] に word 時刻がありません`);
    }
  }
  return value;
}

function markdown(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function number(value) {
  return Number.isFinite(value) ? value.toFixed(3) : "—";
}

function reportSource({
  sessionId,
  backend,
  proposals = [],
  landed = [],
  discarded = [],
  warnings = [],
  unavailableReasons = [],
  mode,
  recompile,
  error = null,
}) {
  const needsConfirmation = landed.filter((entry) => entry.annotation.session.confidence === "low");
  const lines = [
    `# ${sessionId} コンパイルレポート`,
    "",
    `- 結果: ${error ? "拒否 / スキップ" : mode === "prepare" ? "判断待ち" : "コンパイル済み"}`,
    `- 実行: ${recompile ? "再コンパイル（既存 annotation は保持）" : "初回コンパイル"}`,
    `- 文字起こし backend: \`${backend ?? "未取得"}\``,
    `- 集計: 発話 ${proposals.length} 件 → annotation ${landed.length} 件（要確認 ${needsConfirmation.length} 件）・破棄 ${discarded.length} 件`,
    "",
    "## 役割分担",
    "",
    "- bin: STT、無音 + 文境界の発話区切り、recT→timelineT→sourceT、cut hit、暫定採否、原子的追記を決定的に処理する。",
    mode === "agent-reviewed"
      ? "- エージェント: compile-proposals.json の発話原文・参照候補・暫定判定を確認し、decision を確定して着地した。"
      : mode === "prepare"
        ? "- エージェント: compile-proposals.json の decision を確定してから --apply-proposals を実行する（この段階では未着地）。"
        : "- エージェント: 自動一括モードの暫定判定が着地しているため、本レポートと原文をレビューし、曖昧なものを黙殺しない。",
  ];
  if (error) {
    lines.push("", "## 拒否 / スキップ理由", "", `- ${markdown(error)}`);
  }
  if (landed.length > 0) {
    lines.push(
      "",
      "## 着地した annotation",
      "",
      "| id | recT | sourceT | target | 解決法 | confidence | text |",
      "|---|---:|---:|---|---|---|---|",
    );
    for (const entry of landed) {
      const { annotation, proposal } = entry;
      lines.push(
        `| ${annotation.id} | ${number(annotation.session.recRange[0])}–${number(annotation.session.recRange[1])}`
        + ` | ${number(annotation.sourceT)} | ${markdown(annotation.target)}`
        + ` | ${markdown(proposal.reference.resolutionMethod)} | ${annotation.session.confidence}`
        + ` | ${markdown(annotation.text)} |`,
      );
    }
  }
  if (needsConfirmation.length > 0) {
    lines.push("", "## 要確認", "");
    for (const { annotation } of needsConfirmation) {
      lines.push(`- ${annotation.id}: ${markdown(annotation.text)}`);
    }
  }
  lines.push("", "## 破棄した発話", "");
  if (discarded.length === 0) {
    lines.push("- なし");
  } else {
    for (const item of discarded) {
      lines.push(
        `- recT ${number(item.proposal.recRange[0])}–${number(item.proposal.recRange[1])}`
        + `「${markdown(item.proposal.transcript)}」— ${markdown(item.decision.reason)}`,
      );
    }
  }
  if (unavailableReasons.length > 0) {
    lines.push("", "## 文字起こしの劣化", "");
    for (const reason of unavailableReasons) lines.push(`- ${markdown(reason)}`);
    if (backend === "unavailable") {
      lines.push("- 発話ゼロは「発話なし」の断定ではなく、文字起こし未取得として扱う。");
    }
  }
  if (warnings.length > 0) {
    lines.push("", "## warning", "");
    for (const warning of warnings) lines.push(`- ${markdown(warning)}`);
  }
  return `${lines.join("\n")}\n`;
}

async function writeFailureReport(sessionDirectory, sessionId, message, recompile = false) {
  await writeAtomic(path.join(sessionDirectory, "compile-report.md"), reportSource({
    sessionId,
    backend: null,
    warnings: [],
    unavailableReasons: [],
    mode: "automatic",
    recompile,
    error: message,
  }));
}

async function loadOrCreateTranscript({
  transcriptPath,
  session,
  sessionPath,
  sessionDirectory,
  options,
  repoRoot,
}) {
  const warnings = [];
  try {
    const transcript = validateTranscript(await readJson(transcriptPath, "transcript.json"));
    return { transcript, created: false, warnings };
  } catch (error) {
    if (error?.code !== "ENOENT") {
      warnings.push(`transcript.json のスキーマが不正なため再文字起こしします: ${errorText(error)}`);
    }
  }

  const audioPath = path.resolve(sessionDirectory, session.audio ?? "audio.wav");
  ensureInside(sessionDirectory, audioPath, "session.audio");
  const stat = await fs.stat(audioPath).catch(() => null);
  if (!stat?.isFile()) throw new Error("session.audio の音声ファイルがありません");
  const transcript = await transcribeAudio({
    audioPath,
    projectRoot: options.projectRoot,
    repoRoot,
    allowCloudStt: options.allowCloudStt,
    cloudProvider: options.cloudProvider,
    cloudApproved: options.cloudApproved,
  });
  const stored = {
    version: 1,
    backend: transcript.backend,
    provenance: transcript.provenance ?? { backend: transcript.backend },
    segments: transcript.segments,
    ...(transcript.reasons?.length ? { unavailableReasons: transcript.reasons } : {}),
    ...(transcript.decisionCard ? { decisionCard: transcript.decisionCard } : {}),
  };
  await writeJsonAtomic(transcriptPath, stored);
  if (session.status === "recorded") {
    session.status = "transcribed";
    await writeJsonAtomic(sessionPath, session);
  }
  return { transcript: validateTranscript(stored), created: true, warnings };
}

async function compileSession({ sessionId, sessionDirectory, options, repoRoot }) {
  const sessionPath = path.join(sessionDirectory, "session.json");
  let session;
  try {
    session = await readJson(sessionPath, "session.json");
  } catch (error) {
    const message = errorText(error);
    await writeFailureReport(sessionDirectory, sessionId, message);
    return { sessionId, status: "skipped", reason: message };
  }
  if (!session || session.id !== sessionId) {
    const message = `session.json の id (${session?.id ?? "なし"}) がディレクトリ名と一致しません`;
    await writeFailureReport(sessionDirectory, sessionId, message);
    return { sessionId, status: "skipped", reason: message };
  }
  const recompile = session.status === "compiled";
  if (recompile && !options.force) {
    return { sessionId, status: "skipped", reason: "既に compiled のためスキップ" };
  }

  const snapshotPath = path.resolve(sessionDirectory, session.editSnapshot ?? "edit.snapshot.json");
  ensureInside(sessionDirectory, snapshotPath, "session.editSnapshot");
  let snapshot;
  try {
    snapshot = await readJson(snapshotPath, "edit.snapshot.json");
  } catch (error) {
    const message = `コンパイル拒否: ${errorText(error)}。sourceT への写像を推測しません`;
    await writeFailureReport(sessionDirectory, sessionId, message, recompile);
    return { sessionId, status: "rejected", reason: message };
  }

  try {
    const eventsPath = path.join(sessionDirectory, "events.jsonl");
    const eventsSource = await fs.readFile(eventsPath, "utf8");
    const parsedEvents = parseEventsJsonl(eventsSource);
    const trace = buildTimelineTrace(parsedEvents.events);
    const cutMap = buildCutMap(snapshot);
    const transcriptPath = path.join(sessionDirectory, "transcript.json");
    const { transcript, warnings: transcriptWarnings } = await loadOrCreateTranscript({
      transcriptPath,
      session,
      sessionPath,
      sessionDirectory,
      options,
      repoRoot,
    });
    const utterances = segmentUtterances(transcript.segments);
    let proposals;
    const proposalPath = path.join(sessionDirectory, "compile-proposals.json");
    if (options.applyProposals) {
      const prepared = await readJson(proposalPath, "compile-proposals.json");
      if (prepared?.sessionId !== sessionId || !Array.isArray(prepared.proposals)) {
        throw new Error("compile-proposals.json がこのセッションの提案ではありません");
      }
      proposals = prepared.proposals;
      for (const proposal of proposals) {
        if (
          !proposal?.decision
          || !["annotate", "discard"].includes(proposal.decision.action)
          || !["high", "low"].includes(proposal.decision.confidence)
          || typeof proposal.decision.reason !== "string"
          || !proposal.decision.reason.trim()
          || (
            proposal.decision.action === "annotate"
            && (typeof proposal.decision.text !== "string" || !proposal.decision.text.trim())
          )
        ) {
          throw new Error(
            `compile-proposals.json proposals[${proposal?.index ?? "?"}].decision を確定してください`,
          );
        }
      }
    } else {
      proposals = buildProposals({ utterances, trace, cutMap });
    }

    const warnings = [...parsedEvents.warnings, ...transcriptWarnings];
    const unavailableReasons = Array.isArray(transcript.unavailableReasons)
      ? transcript.unavailableReasons
      : [];
    if (options.prepareOnly) {
      await writeJsonAtomic(proposalPath, {
        version: 1,
        sessionId,
        backend: transcript.backend,
        proposals,
      });
      await writeAtomic(path.join(sessionDirectory, "compile-report.md"), reportSource({
        sessionId,
        backend: transcript.backend,
        proposals,
        warnings,
        unavailableReasons,
        mode: "prepare",
        recompile,
      }));
      return {
        sessionId,
        status: "prepared",
        utterances: proposals.length,
        proposalPath,
      };
    }

    const discarded = [];
    const pending = [];
    for (const proposal of proposals) {
      const decision = chooseProposalDecision(proposal);
      if (decision.action === "discard") {
        discarded.push({ proposal, decision });
      } else {
        pending.push({
          proposal,
          decision,
          annotation: proposalToAnnotation({
            proposal,
            decision,
            sessionId,
            audioPath: relativeAudioPath(sessionId, session.audio ?? "audio.wav"),
            createdAt: new Date().toISOString(),
          }),
        });
      }
    }
    const assigned = await appendAnnotationsAtomic(
      path.join(options.projectRoot, "review.json"),
      pending.map((entry) => entry.annotation),
    );
    const landed = pending.map((entry, index) => ({
      ...entry,
      annotation: assigned[index],
    }));
    const previousIds = Array.isArray(session.compiledAnnotations) ? session.compiledAnnotations : [];
    session.status = "compiled";
    session.compiledAnnotations = [...previousIds, ...assigned.map((annotation) => annotation.id)];
    await writeJsonAtomic(sessionPath, session);
    await writeAtomic(path.join(sessionDirectory, "compile-report.md"), reportSource({
      sessionId,
      backend: transcript.backend,
      proposals,
      landed,
      discarded,
      warnings,
      unavailableReasons,
      mode: options.applyProposals ? "agent-reviewed" : "automatic",
      recompile,
    }));
    return {
      sessionId,
      status: "compiled",
      recompiled: recompile,
      backend: transcript.backend,
      utterances: proposals.length,
      annotations: assigned.map((annotation) => ({
        id: annotation.id,
        sourceT: annotation.sourceT,
        target: annotation.target,
        confidence: annotation.session.confidence,
      })),
      discarded: discarded.length,
      needsConfirmation: assigned.filter((annotation) => annotation.session.confidence === "low").length,
    };
  } catch (error) {
    const message = errorText(error);
    await writeFailureReport(sessionDirectory, sessionId, message, recompile);
    return { sessionId, status: "failed", reason: message };
  }
}

async function sessionIds(options) {
  const sessionsRoot = path.join(options.projectRoot, "review", "sessions");
  if (options.session) return [options.session];
  let entries;
  try {
    entries = await fs.readdir(sessionsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory() && /^s-\d{4,}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${errorText(error)}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDirectory, "../../..");
  const ids = await sessionIds(options);
  const results = [];
  for (const sessionId of ids) {
    const directory = path.join(options.projectRoot, "review", "sessions", sessionId);
    results.push(await compileSession({
      sessionId,
      sessionDirectory: directory,
      options,
      repoRoot,
    }));
  }
  const summary = {
    projectRoot: options.projectRoot,
    force: options.force,
    mode: options.prepareOnly ? "prepare" : options.applyProposals ? "apply-proposals" : "automatic",
    results,
    totals: {
      sessions: results.length,
      compiled: results.filter((result) => result.status === "compiled").length,
      prepared: results.filter((result) => result.status === "prepared").length,
      skipped: results.filter((result) => result.status === "skipped").length,
      rejected: results.filter((result) => result.status === "rejected").length,
      failed: results.filter((result) => result.status === "failed").length,
      annotations: results.reduce((sum, result) => sum + (result.annotations?.length ?? 0), 0),
      discarded: results.reduce((sum, result) => sum + (result.discarded ?? 0), 0),
    },
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } else {
    for (const result of results) {
      const detail = result.reason
        ?? (result.annotations ? `annotation ${result.annotations.length} 件 / 破棄 ${result.discarded} 件` : "");
      process.stdout.write(`${result.sessionId}: ${result.status}${detail ? ` — ${detail}` : ""}\n`);
    }
    process.stdout.write(
      `集計: sessions=${summary.totals.sessions}, compiled=${summary.totals.compiled},`
      + ` annotations=${summary.totals.annotations}, discarded=${summary.totals.discarded},`
      + ` skipped=${summary.totals.skipped}, rejected=${summary.totals.rejected}, failed=${summary.totals.failed}\n`,
    );
  }
  const successCount = summary.totals.compiled + summary.totals.prepared + summary.totals.skipped;
  if (successCount === 0 && summary.totals.rejected + summary.totals.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${errorText(error)}\n`);
  process.exitCode = 2;
});
