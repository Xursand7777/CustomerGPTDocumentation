// Builds api-reference/actions/openapi.json from the live CustomerGPT agent API.
//
// The backend publishes every agent action as its own POST endpoint at
// /api/agents/openapi.json, but without a server URL, titles or groups. This
// script adds those, using the action catalog at /api/v1/agents/actions for the
// titles, so Mintlify can render one readable page per action with a working
// "Try it" playground.
//
// Usage: node scripts/sync-openapi.mjs [--check]
//   --check  exit 1 if the committed file is out of date (for CI)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ORIGIN = process.env.CUSTOMERGPT_API_URL ?? "https://api.customergpt.ai";
const OUT = fileURLToPath(new URL("../api-reference/actions/openapi.json", import.meta.url));

// Navigation groups, in the order they appear in docs.json.
const GROUPS = {
  Chatbots: ["chatbots_list", "chatbots_get", "chatbots_create", "chatbots_update", "chatbots_delete", "installation_snippet"],
  Knowledge: ["sources_list", "sources_add", "sources_sync", "sources_delete", "training_status", "jobs_get"],
  "Custom responses": ["responses_list", "responses_create", "responses_update", "responses_delete"],
  Conversations: ["conversations_list", "conversations_get", "conversations_update", "conversations_tag", "conversations_bulk_update", "messages_reply", "messages_send"],
  "Analytics and account": ["analytics_get", "account_usage", "account_limits"],
  "API keys and team": ["tokens_list", "tokens_create", "tokens_revoke", "members_list", "members_remove"],
  Onboarding: ["onboarding_start", "onboarding_preview", "onboarding_claim"],
};

async function getJson(path) {
  const response = await fetch(ORIGIN + path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

const [spec, catalog] = await Promise.all([
  getJson("/api/agents/openapi.json"),
  getJson("/api/v1/agents/actions"),
]);

const titles = Object.fromEntries(catalog.actions.map((action) => [action.name, action.title]));
const groupOf = Object.fromEntries(
  Object.entries(GROUPS).flatMap(([group, names]) => names.map((name) => [name, group])),
);

const unknown = [];
for (const operations of Object.values(spec.paths)) {
  for (const operation of Object.values(operations)) {
    const name = operation.operationId;
    if (!groupOf[name]) unknown.push(name);
    operation.summary = titles[name] ?? name;
    operation.tags = [groupOf[name] ?? "Other"];
    // The backend lists fields that have a default (dryRun, confirm, page, limit)
    // as required. They aren't: leave them out so the playground doesn't send them.
    const schema = operation.requestBody?.content?.["application/json"]?.schema;
    if (schema?.required && schema.properties) {
      schema.required = schema.required.filter((field) => !("default" in (schema.properties[field] ?? {})));
      if (!schema.required.length) delete schema.required;
    }
  }
}

spec.servers = [{ url: ORIGIN }];
spec.tags = [...Object.keys(GROUPS), ...(unknown.length ? ["Other"] : [])].map((name) => ({ name }));

const output = JSON.stringify(spec, null, 2) + "\n";

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {}
  if (current.replace(/\r\n/g, "\n") !== output) {
    console.error("api-reference/actions/openapi.json is out of date. Run: node scripts/sync-openapi.mjs");
    process.exit(1);
  }
  console.log("api-reference/actions/openapi.json is up to date.");
} else {
  writeFileSync(OUT, output);
  console.log(`Wrote ${Object.keys(spec.paths).length} actions to api-reference/actions/openapi.json`);
}

if (unknown.length) {
  console.warn(`New actions without a group (listed under "Other"): ${unknown.join(", ")}`);
  console.warn("Add them to GROUPS in scripts/sync-openapi.mjs and to docs.json.");
}
