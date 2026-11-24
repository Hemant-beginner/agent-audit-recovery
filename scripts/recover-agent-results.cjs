"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
const MAX_RESULT_BYTES = 5 * 1024 * 1024;
const OWNER_PATTERN = /(?:^|[\\/])agents[\\/]([a-z0-9][a-z0-9_-]{0,63})[\\/]prompt\.md(?=$|[\\/\s'"`])/i;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function usage() {
  return "Usage: node recover-agent-results.cjs --transcript <session.jsonl> --out <new-staging-dir> [--expect <id,id>]";
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { expect: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--expect") {
      const value = argv[++i];
      if (!value) fail("--expect requires a comma-separated owner list");
      options.expect.push(...value.split(",").map((x) => x.trim()).filter(Boolean));
    } else if (arg === "--transcript" || arg === "--out") {
      const value = argv[++i];
      if (!value) fail(`${arg} requires a path`);
      options[arg.slice(2)] = value;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  if (!options.transcript || !options.out) fail(usage());
  for (const owner of options.expect) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(owner) || WINDOWS_DEVICE.test(owner)) {
      fail(`Invalid expected owner: ${owner}`);
    }
  }
  return options;
}

function regularFile(file, label, limit) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    fail(`${label} is unavailable: ${error.code || error.message}`);
  }
  if (!stat.isFile()) fail(`${label} must be a regular file`);
  if (stat.size > limit) fail(`${label} exceeds ${limit} bytes`);
  return stat;
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function ownerFromPrompt(prompt) {
  if (typeof prompt !== "string") return null;
  const matches = [...prompt.matchAll(new RegExp(OWNER_PATTERN.source, "gi"))];
  const owners = [...new Set(matches.map((match) => match[1].toLowerCase()))];
  if (owners.length !== 1 || WINDOWS_DEVICE.test(owners[0])) return null;
  return owners[0];
}

function quotaFailure(text) {
  return /credit usage limit|credit limit|quota exceeded|usage limit has been reached/i.test(text);
}

function parseResult(text) {
  if (quotaFailure(text)) return { kind: "quota" };
  const start = text.indexOf("{");
  if (start < 0) return { kind: "invalid", reason: "no JSON object start" };
  let value;
  try {
    value = JSON.parse(text.slice(start));
  } catch (error) {
    return { kind: "invalid", reason: `invalid JSON: ${error.message}` };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "invalid", reason: "result is not an object" };
  }
  if (!Array.isArray(value.units) || !Array.isArray(value.candidates)) {
    return { kind: "invalid", reason: "units and candidates must be arrays" };
  }
  return { kind: "valid", value };
}

function writeExclusive(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { encoding: "utf8", flag: "wx" });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const transcript = path.resolve(options.transcript);
  const out = path.resolve(options.out);
  regularFile(transcript, "Transcript", MAX_TRANSCRIPT_BYTES);
  if (fs.existsSync(out)) fail(`Staging directory already exists: ${out}`);

  const calls = new Map();
  const results = new Map();
  const rejected = [];
  const unmatchedResults = [];
  let rows = 0;
  let malformedRows = 0;
  let duplicateRows = 0;
  const input = fs.createReadStream(transcript, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line.trim()) continue;
    rows += 1;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      malformedRows += 1;
      continue;
    }
    const content = row && row.message && row.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "tool_use" && block.name === "Agent" && typeof block.id === "string") {
        if (calls.has(block.id)) {
          duplicateRows += 1;
        } else {
          calls.set(block.id, { owner: ownerFromPrompt(block.input && block.input.prompt), row: rows });
        }
        continue;
      }
      if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
      const call = calls.get(block.tool_use_id);
      if (!call) {
        unmatchedResults.push({ toolUseId: block.tool_use_id, row: rows });
        continue;
      }
      if (results.has(block.tool_use_id) || rejected.some((entry) => entry.toolUseId === block.tool_use_id)) {
        duplicateRows += 1;
        continue;
      }
      const text = textFromContent(block.content);
      const parsed = parseResult(text);
      const rejection = {
        toolUseId: block.tool_use_id,
        row: rows,
        owner: call.owner,
        kind: "invalid",
        reason: parsed.reason || "provider quota or credit failure",
        raw: text
      };
      if (!call.owner) {
        rejection.kind = "ambiguous_owner";
        rejection.reason = "Agent prompt does not identify exactly one owner";
      } else if (parsed.kind === "valid") {
        results.set(block.tool_use_id, {
          owner: call.owner,
          toolUseId: block.tool_use_id,
          value: parsed.value,
          row: rows
        });
        continue;
      } else {
        rejection.kind = parsed.kind;
      }
      rejected.push(rejection);
    }
  }

  const byOwner = new Map();
  for (const result of results.values()) {
    if (!byOwner.has(result.owner)) byOwner.set(result.owner, []);
    byOwner.get(result.owner).push(result);
  }
  const recovered = [];
  const duplicates = [];
  for (const [owner, entries] of byOwner) {
    if (entries.length > 1) {
      duplicates.push({ owner, toolUseIds: entries.map((entry) => entry.toolUseId), rows: entries.map((entry) => entry.row) });
      continue;
    }
    const entry = entries[0];
    const serialized = `${JSON.stringify(entry.value, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_RESULT_BYTES) {
      rejected.push({
        owner,
        toolUseId: entry.toolUseId,
        row: entry.row,
        kind: "oversized_result",
        reason: `result exceeds ${MAX_RESULT_BYTES} bytes`,
        raw: serialized
      });
      continue;
    }
    writeExclusive(path.join(out, "results", `${owner}.json`), serialized);
    recovered.push({ owner, toolUseId: entry.toolUseId, row: entry.row });
  }
  const usedRawNames = new Set();
  for (const rejection of rejected) {
    if (!rejection.owner) continue;
    const base = rejection.owner;
    let index = 0;
    let rawFile = `${base}.txt`;
    while (usedRawNames.has(rawFile)) {
      index += 1;
      rawFile = `${base}.${index}.txt`;
    }
    usedRawNames.add(rawFile);
    rejection.rawFile = rawFile;
    writeExclusive(path.join(out, "raw", rawFile), rejection.raw || "");
    delete rejection.raw;
  }

  const expected = [...new Set(options.expect)];
  const missing = expected.filter((owner) => !recovered.some((entry) => entry.owner === owner));
  const manifest = {
    transcript,
    rows,
    malformedRows,
    duplicateRows,
    agentCalls: calls.size,
    recovered,
    duplicates,
    rejected,
    unmatchedResults,
    expected,
    missing
  };
  writeExclusive(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Recovered ${recovered.length} result(s) into ${out}`);
  if (rejected.length) console.log(`Rejected ${rejected.length} result(s); review manifest before reassignment`);
  if (missing.length) console.log(`Missing expected owner(s): ${missing.join(", ")}`);
  if (malformedRows) console.log(`WARNING: skipped ${malformedRows} malformed transcript row(s)`);
  if (duplicates.length || unmatchedResults.length) {
    console.log("NOTE: unrelated or unmatched Agent calls are reported in the manifest");
  }
  if (missing.length || duplicates.some((entry) => expected.includes(entry.owner))) {
    console.log("WARNING: requested transcript recovery is incomplete");
    process.exitCode = 2;
  }
}

main().catch((error) => fail(error.message));
