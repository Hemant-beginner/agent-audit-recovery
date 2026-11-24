"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const MAX_LEDGER_BYTES = 5 * 1024 * 1024;
const AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FINGERPRINT = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const DISPOSITIONS = new Set(["covered", "candidate", "blocked"]);

function usage() {
  return "Usage: node consolidate-ledger.cjs --ledger <coverage-ledger.json> --result <hunter-result.json> --agent <owner> [--skill-dir <governing-skill-dir>] [--out <staged-ledger.json>] [--write]";
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") {
      options.write = true;
    } else if (["--ledger", "--result", "--agent", "--skill-dir", "--out"].includes(arg)) {
      const value = argv[++i];
      if (!value) fail(`${arg} requires a value`);
      options[arg === "--skill-dir" ? "skillDir" : arg.slice(2)] = value;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  if (!options.ledger || !options.result || !options.agent) fail(usage());
  if (!AGENT_ID.test(options.agent) || WINDOWS_DEVICE.test(options.agent)) fail("Invalid agent ID");
  if (options.write && !options.skillDir) fail("--write requires --skill-dir for semantic validation");
  if (options.out && options.write) fail("--out cannot be combined with --write");
  return options;
}

function readBoundedJson(file, label) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    fail(`${label} is unavailable: ${error.code || error.message}`);
  }
  if (!stat.isFile()) fail(`${label} must be a regular file`);
  if (stat.size > MAX_LEDGER_BYTES) fail(`${label} exceeds 5 MiB`);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
  return value;
}

function assertRepoPath(value, label) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes(":") || path.posix.isAbsolute(value)) {
    fail(`${label} must be a repository-relative path`);
  }
  if (value.split("/").some((part) => !part || part === "." || part === "..")) {
    fail(`${label} contains an unsafe path segment`);
  }
}

function assertUnitShape(unit) {
  if (!unit || typeof unit !== "object" || Array.isArray(unit)) fail("Each unit must be an object");
  if (typeof unit.coverage_id !== "string" || !unit.coverage_id) fail("Unit coverage_id is required");
  if (!Array.isArray(unit.checks) || unit.checks.length === 0) fail(`${unit.coverage_id}: checks must be nonempty`);
  const allPaths = new Set();
  for (const check of unit.checks) {
    if (!check || typeof check !== "object" || Array.isArray(check)) fail(`${unit.coverage_id}: invalid check`);
    if (!AGENT_ID.test(check.agent_id || "") || WINDOWS_DEVICE.test(check.agent_id || "")) {
      fail(`${unit.coverage_id}: invalid check agent_id`);
    }
    if (!Array.isArray(check.reviewed_paths) || check.reviewed_paths.length === 0) {
      fail(`${unit.coverage_id}: check reviewed_paths must be nonempty`);
    }
    for (const reviewedPath of check.reviewed_paths) {
      assertRepoPath(reviewedPath, `${unit.coverage_id}: reviewed path`);
      allPaths.add(reviewedPath);
    }
    if (typeof check.invariant !== "string" || !check.invariant.trim()) fail(`${unit.coverage_id}: invariant is required`);
    if (check.method !== "source" && check.method !== "local") fail(`${unit.coverage_id}: unsupported check method`);
    if (typeof check.result !== "string" || !check.result.trim()) fail(`${unit.coverage_id}: check result is required`);
    if (check.method === "source" && check.artifact !== null) fail(`${unit.coverage_id}: source checks require artifact null`);
    if (check.method === "local") {
      assertRepoPath(check.artifact, `${unit.coverage_id}: artifact`);
      if (!check.artifact.startsWith(`agents/${check.agent_id}/artifacts/`)) {
        fail(`${unit.coverage_id}: local artifact must belong to its check owner`);
      }
    }
  }
  if (!Array.isArray(unit.reviewed_paths)) fail(`${unit.coverage_id}: reviewed_paths must be an array`);
  for (const reviewedPath of unit.reviewed_paths) {
    assertRepoPath(reviewedPath, `${unit.coverage_id}: reviewed path`);
    if (!allPaths.has(reviewedPath)) fail(`${unit.coverage_id}: reviewed_paths must equal the check path union`);
  }
  if (new Set(unit.reviewed_paths).size !== unit.reviewed_paths.length) fail(`${unit.coverage_id}: duplicate reviewed path`);
  if (unit.reviewed_paths.length !== allPaths.size) fail(`${unit.coverage_id}: reviewed_paths must equal the check path union`);
  if (!Array.isArray(unit.unresolved) || unit.unresolved.some((item) => typeof item !== "string" || !item.trim())) {
    fail(`${unit.coverage_id}: unresolved must contain nonempty strings`);
  }
  if (!Array.isArray(unit.candidate_fingerprints)) fail(`${unit.coverage_id}: candidate_fingerprints must be an array`);
  for (const fingerprint of unit.candidate_fingerprints) {
    if (typeof fingerprint !== "string" || !FINGERPRINT.test(fingerprint)) fail(`${unit.coverage_id}: invalid fingerprint`);
  }
  if (new Set(unit.candidate_fingerprints).size !== unit.candidate_fingerprints.length) {
    fail(`${unit.coverage_id}: duplicate candidate fingerprint`);
  }
  if (!DISPOSITIONS.has(unit.disposition)) fail(`${unit.coverage_id}: invalid disposition`);
  if (unit.disposition === "covered" && (unit.unresolved.length || unit.candidate_fingerprints.length)) {
    fail(`${unit.coverage_id}: covered unit cannot carry unresolved facts or fingerprints`);
  }
  if (unit.disposition === "blocked" && (!unit.unresolved.length || unit.candidate_fingerprints.length)) {
    fail(`${unit.coverage_id}: blocked unit requires unresolved facts and no fingerprints`);
  }
  if (unit.disposition === "candidate" && !unit.candidate_fingerprints.length) {
    fail(`${unit.coverage_id}: candidate unit requires fingerprints`);
  }
}

function validateSemantically(ledgerFile, skillDir) {
  const adapter = path.join(__dirname, "validate-windows.cjs");
  const result = spawnSync(process.execPath, [adapter, "--skill-dir", skillDir, "ledger", ledgerFile], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.error) fail(`Validator could not start: ${result.error.message}`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) fail("Semantic ledger validation failed");
}

function atomicWrite(file, value) {
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(temporary, value, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const ledgerFile = path.resolve(options.ledger);
  const resultFile = path.resolve(options.result);
  const ledger = readBoundedJson(ledgerFile, "Ledger");
  const result = readBoundedJson(resultFile, "Result");
  if (!Array.isArray(ledger)) fail("Ledger must be a top-level array");
  if (!result || typeof result !== "object" || Array.isArray(result)) fail("Result must be an object");
  if (!Array.isArray(result.units) || !Array.isArray(result.candidates)) fail("Result requires units and candidates arrays");

  const byId = new Map();
  for (const unit of ledger) {
    if (!unit || typeof unit.coverage_id !== "string" || !unit.coverage_id) fail("Ledger contains a unit without coverage_id");
    if (byId.has(unit.coverage_id)) fail(`Duplicate ledger coverage_id: ${unit.coverage_id}`);
    byId.set(unit.coverage_id, unit);
  }
  const seen = new Set();
  const unitFingerprints = new Set();
  const existingFingerprints = new Set(ledger.flatMap((unit) => unit.result_fingerprints || []));
  const hardening = [];
  const uncovered = [];
  if (Array.isArray(result.hardening)) hardening.push(...result.hardening);
  if (Array.isArray(result.uncovered)) uncovered.push(...result.uncovered);
  if (result.units.length === 0) fail("Result contains no assigned units");
  if (result.candidates.some((candidate) => !candidate || typeof candidate !== "object" || typeof candidate.fingerprint !== "string")) {
    fail("Each candidate requires a fingerprint");
  }
  for (const unit of result.units) {
    if (!unit || typeof unit !== "object" || Array.isArray(unit)) fail("Each returned unit must be an object");
    if (typeof unit.coverage_id !== "string" || !unit.coverage_id) fail("Result contains a unit without coverage_id");
    if (!Array.isArray(unit.candidate_fingerprints)) fail(`${unit.coverage_id}: candidate_fingerprints must be an array`);
    for (const fingerprint of unit.candidate_fingerprints) unitFingerprints.add(fingerprint);
    if (seen.has(unit.coverage_id)) fail(`Duplicate result coverage_id: ${unit.coverage_id}`);
    seen.add(unit.coverage_id);
    const target = byId.get(unit.coverage_id);
    if (!target) fail(`Result references an unassigned coverage_id: ${unit.coverage_id}`);
    if (target.status !== "in_progress") fail(`${unit.coverage_id}: ledger unit is not in_progress`);
    if (target.agent_id !== options.agent) fail(`${unit.coverage_id}: result owner does not match assignment`);
    assertUnitShape(unit);
    target.status = unit.disposition;
    target.agent_id = options.agent;
    target.reviewed_paths = [...unit.reviewed_paths].sort();
    target.local_checks = unit.checks;
    target.result_fingerprints = [...unit.candidate_fingerprints];
    target.unresolved = [...unit.unresolved];
    if (hardening.length) {
      target.recovery_bookkeeping = { hardening: [...hardening] };
    }
    if (uncovered.length) {
      target.recovery_bookkeeping = { ...(target.recovery_bookkeeping || {}), uncovered: [...uncovered] };
    }
  }

  if (!result.candidates.every((candidate) => {
    return unitFingerprints.has(candidate.fingerprint) || existingFingerprints.has(candidate.fingerprint);
  })) {
    fail("Every new candidate fingerprint must be linked from a returned unit");
  }

  ledger.sort((left, right) => left.coverage_id < right.coverage_id ? -1 : left.coverage_id > right.coverage_id ? 1 : 0);
  const serialized = `${JSON.stringify(ledger, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_LEDGER_BYTES) fail("Merged ledger exceeds 5 MiB");
  const outputFile = options.out ? path.resolve(options.out) : options.write ? ledgerFile : path.join(os.tmpdir(), `recovered-ledger-${process.pid}.json`);
  if (options.write) {
    validateSemantically(ledgerFile, options.skillDir);
    const temporary = path.join(path.dirname(ledgerFile), `.${path.basename(ledgerFile)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
    try {
      fs.writeFileSync(temporary, serialized, { encoding: "utf8", flag: "wx" });
      validateSemantically(temporary, options.skillDir);
      fs.renameSync(temporary, ledgerFile);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  } else {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, serialized, { encoding: "utf8", flag: "wx" });
  }
  console.log(`${options.write ? "MERGED" : "STAGED"} ${result.units.length} unit(s); ${ledger.length} ledger record(s); output: ${outputFile}`);
}

if (require.main === module) main();

module.exports = { main, atomicWrite };
