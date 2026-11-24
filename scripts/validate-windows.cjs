"use strict";

const fs = require("fs");
const path = require("path");

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

function usage() {
  return "Usage: node validate-windows.cjs --skill-dir <governing-skill-dir> <ledger|findings> <document>";
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  let skillDir;
  let kind;
  let file;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--skill-dir") {
      skillDir = argv[++i];
      if (!skillDir) fail("--skill-dir requires a path");
    } else if (!kind && ["ledger", "findings"].includes(arg)) {
      kind = arg;
    } else if (!file) {
      file = arg;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  if (!skillDir || !kind || !file) fail(usage());
  return { skillDir: path.resolve(skillDir), kind, file: path.resolve(file) };
}

function readBoundedJson(file, label) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    fail(`${label} is unavailable: ${error.code || error.message}`);
  }
  if (!stat.isFile()) fail(`${label} must be a regular file`);
  if (stat.size > MAX_DOCUMENT_BYTES) fail(`${label} exceeds 5 MiB`);
  return fs.readFileSync(file, "utf8");
}

function loadValidator(skillDir, kind) {
  const name = kind === "ledger" ? "validate-coverage-ledger.cjs" : "validate-findings.cjs";
  let validator;
  try {
    validator = require(path.join(skillDir, name));
  } catch (error) {
    fail(`Cannot load ${name}: ${error.message}`);
  }
  if (typeof validator.preflightJsonText !== "function" && kind === "ledger") {
    fail("Ledger validator does not export preflightJsonText");
  }
  if (typeof validator.validateDocument !== "function") {
    fail("Validator does not export validateDocument");
  }
  return validator;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const contents = readBoundedJson(options.file, "Document");
  const validator = loadValidator(options.skillDir, options.kind);
  let document;
  let errors;
  try {
    if (options.kind === "ledger") {
      validator.preflightJsonText(contents);
      document = JSON.parse(contents);
      errors = validator.validateDocument(document);
    } else {
      const schemaText = readBoundedJson(path.join(options.skillDir, "report-schema.json"), "Report schema");
      document = JSON.parse(contents);
      errors = validator.validateDocument(document, JSON.parse(schemaText));
    }
  } catch (error) {
    fail(`Validation could not complete: ${error.message}`);
  }
  if (!Array.isArray(errors)) fail("Validator returned a non-array error collection");
  for (const message of errors) console.error(`ERROR: ${message}`);
  if (errors.length) {
    console.error(`FAIL: ${errors.length} validation error(s)`);
    process.exit(1);
  }
  const count = Array.isArray(document) ? document.length : Object.keys(document).length;
  console.log(`PASS (${options.kind}, windows-adapted trusted read): ${count} top-level item(s) valid`);
}

if (require.main === module) main();

module.exports = { main };
