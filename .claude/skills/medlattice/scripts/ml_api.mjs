#!/usr/bin/env node
/**
 * MedLattice /api/v1 CLI for Claude Code / agents.
 * Usage: node ml_api.mjs <command> [--flag value ...]
 */
const BASE = (process.env.MEDLATTICE_BASE_URL || "https://med.aispeedtest.eu").replace(/\/$/, "");
const KEY = process.env.MEDLATTICE_API_KEY?.trim() || "";

function usage(code = 1) {
  console.error(`MedLattice API CLI

Usage:
  node ml_api.mjs <command> [flags]

Commands:
  catalog
  citations   --text STR | --reference STR | --references JSON_ARRAY
  match       --text STR
  papers      --q STR [--sort relevance|citations|date] [--since YEAR] [--oa 0|1] [--page N]
  map         --q STR
  datasets    --q STR
  journals    --q STR
  journal     --id STR
  trials      --q STR [--mode auto|paper|trial]
  search      --q STR
  pdf         [--url STR] [--doi STR] [--mode redirect|proxy]

Env:
  MEDLATTICE_BASE_URL   default ${BASE}
  MEDLATTICE_API_KEY    optional X-API-Key
`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usage(0);
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "1";
      out[key] = val;
    } else {
      out._.push(a);
    }
  }
  return out;
}

async function req(method, path, { query, body } = {}) {
  const url = new URL(BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const headers = { Accept: "application/json" };
  if (KEY) headers["X-API-Key"] = KEY;
  if (body != null) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const looksHtml = /^\s*</.test(text);
    data = {
      ok: false,
      error: looksHtml
        ? `Non-JSON response (HTML). Is ${url.origin} deployed with /api/v1? Body starts: ${text.slice(0, 120)}`
        : text.slice(0, 500),
      code: "upstream",
    };
  }
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  if (!res.ok || data?.ok === false) process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd) usage(1);

  switch (cmd) {
    case "catalog":
      return req("GET", "/api/v1");
    case "citations": {
      const body = {};
      if (args.references) body.references = JSON.parse(args.references);
      else if (args.reference) body.reference = args.reference;
      else if (args.text) body.text = args.text;
      else {
        console.error("citations requires --text, --reference, or --references");
        process.exit(1);
      }
      return req("POST", "/api/v1/citations", { body });
    }
    case "match":
      if (!args.text) {
        console.error("match requires --text");
        process.exit(1);
      }
      return req("POST", "/api/v1/match", { body: { text: args.text } });
    case "papers":
      if (!args.q) {
        console.error("papers requires --q");
        process.exit(1);
      }
      return req("GET", "/api/v1/papers", {
        query: { q: args.q, sort: args.sort, since: args.since, oa: args.oa, page: args.page },
      });
    case "map":
    case "datasets":
    case "search":
      if (!args.q) {
        console.error(`${cmd} requires --q`);
        process.exit(1);
      }
      return req("GET", `/api/v1/${cmd}`, { query: { q: args.q } });
    case "journals":
      if (!args.q) {
        console.error("journals requires --q");
        process.exit(1);
      }
      return req("GET", "/api/v1/journals", { query: { q: args.q } });
    case "journal":
      if (!args.id) {
        console.error("journal requires --id");
        process.exit(1);
      }
      return req("GET", `/api/v1/journals/${encodeURIComponent(args.id)}`);
    case "trials":
      if (!args.q) {
        console.error("trials requires --q");
        process.exit(1);
      }
      return req("GET", "/api/v1/trials", { query: { q: args.q, mode: args.mode || "auto" } });
    case "pdf":
      if (!args.url && !args.doi) {
        console.error("pdf requires --url and/or --doi");
        process.exit(1);
      }
      return req("GET", "/api/v1/pdf", {
        query: { url: args.url, doi: args.doi, mode: args.mode || "redirect", format: "json" },
      });
    default:
      console.error(`Unknown command: ${cmd}`);
      usage(1);
  }
}

main().catch((err) => {
  console.error(String(err?.stack || err));
  process.exit(1);
});
