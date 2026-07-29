/**
 * Smoke test for netlify/functions/ask.mjs — run before pushing:
 *
 *   node scripts/smoke-ask.mjs
 *
 * `node --check` only validates syntax. It cannot catch a typo'd variable name
 * inside the handler, which is exactly the sort of thing that reaches production
 * and shows up as a 502. This actually invokes the handler with a fake key, so a
 * runtime error surfaces here instead of on the live site.
 *
 * Expected result: reaches the provider and fails ONLY on the fake key.
 */

import { pathToFileURL } from "node:url";

process.env.URL = "https://example.netlify.app";
process.env.GEMINI_API_KEY = "fake-key-for-smoke-test";

const { default: handler } = await import(
  pathToFileURL("netlify/functions/ask.mjs").href
);

const body = JSON.stringify({
  question: "smoke test",
  subgraph: { anchors: ["X"] },
  sections: [{ heading: "Who is involved", facts: "A, B" }],
});
const mk = (origin) =>
  new Request("https://example.netlify.app/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body,
  });

let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? "  ok  " : "FAIL  "} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
};

const res = await handler(mk("https://example.netlify.app"));
const text = await res.text();

check(
  "handler runs without a runtime error",
  !text.includes("errorType") && !text.includes("ReferenceError"),
  text.slice(0, 120),
);
check("allowed origin gets past the guard", res.status !== 403);
check(
  "fails on the fake key, not on our own code",
  res.status === 502,
  `status ${res.status}`,
);

const bad = await handler(mk("https://evil.example.com"));
check("foreign origin is rejected", bad.status === 403, `status ${bad.status}`);

const noSections = await handler(
  new Request("https://example.netlify.app/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.netlify.app" },
    body: JSON.stringify({ question: "x", subgraph: {} }),
  }),
);
check("malformed request is rejected", noSections.status === 400, `status ${noSections.status}`);

console.log(failed ? "\nSMOKE TEST FAILED" : "\nall good");
process.exit(failed ? 1 : 0);
