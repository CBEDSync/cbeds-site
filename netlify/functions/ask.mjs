/**
 * CBEDSync "Ask the graph" — LLM narrative proxy.
 *
 * The browser does the retrieval (it already holds the whole graph) and posts a
 * subgraph plus the section headings it has already laid out; this function adds
 * the API key and asks a model to write one short paragraph per section. The key
 * lives only in Netlify's environment — never in the page.
 *
 * Netlify → Site configuration → Environment variables:
 *   GEMINI_API_KEY     free tier, no card:  https://aistudio.google.com/apikey
 *   LLM_PROVIDER       "gemini" (default) or "claude"
 *   ANTHROPIC_API_KEY  only needed when LLM_PROVIDER=claude
 *
 * Optional: GEMINI_MODEL, CLAUDE_MODEL, EXTRA_ALLOWED_HOSTS.
 */

const PROVIDER = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
/* Google retires models on a schedule and a retired one answers 404, so try a list
   rather than a single name — otherwise this quietly stops working months from now
   with nobody watching. First that answers wins and is reused.
   Lite leads: these are 50-word notes about facts already on screen, so latency
   matters more here than prose quality. Put gemini-3.6-flash first (or set
   GEMINI_MODEL, which also takes a comma-separated list) to prefer the fuller model. */
const GEMINI_MODELS = (
  process.env.GEMINI_MODEL || "gemini-3.5-flash-lite,gemini-3.6-flash,gemini-2.5-flash-lite"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";

/* Only our own pages may call this. Netlify injects the site's own addresses at
   runtime, so this configures itself — including a custom domain and deploy
   previews. EXTRA_ALLOWED_HOSTS (comma-separated) covers anything unusual. */
const ALLOWED_HOSTS = [
  process.env.URL, // the site's primary address, custom domain included
  process.env.DEPLOY_PRIME_URL, // branch and preview deploys
  process.env.DEPLOY_URL,
]
  .filter(Boolean)
  .map((u) => {
    try {
      return new URL(u).hostname;
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .concat(
    (process.env.EXTRA_ALLOWED_HOSTS || "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
  )
  .concat(["localhost", "127.0.0.1"]); // `netlify dev` on this machine

/* Crude per-IP throttle. Serverless instances don't share memory, so this blunts
   casual abuse rather than preventing it — the real backstop is the provider's
   own quota (Gemini free tier) or a spend limit in the Anthropic Console. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const seen = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  seen.push(now);
  hits.set(ip, seen);
  if (hits.size > 5000) hits.clear(); // keep the map from growing unbounded
  return seen.length > MAX_PER_WINDOW;
}

function sameSite(req) {
  const origin = req.headers.get("origin") || req.headers.get("referer") || "";
  if (!origin) return false;
  try {
    return ALLOWED_HOSTS.includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/* Identical question over identical data gives identical paragraphs, so a warm
   instance can answer repeats for free. Instances are ephemeral and not shared,
   so this is a bonus rather than a guarantee — the browser caches too. */
const CACHE = new Map();
const CACHE_MAX = 300;
function hashKey(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + ":" + s.length;
}
function cacheGet(k) {
  const v = CACHE.get(k);
  if (v) {
    CACHE.delete(k);
    CACHE.set(k, v); // refresh recency
  }
  return v;
}
function cacheSet(k, v) {
  CACHE.set(k, v);
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
}

const SYSTEM = `You are writing short narrative glosses for CBEDSync, the knowledge graph of the
UK built-environment data-sharing ecosystem, run by CBEDS at UCL.

You will be given a user's question, a SUBGRAPH (the agents — organisations and
experts — projects, outputs and value themes the site retrieved, plus the
managedBy / producedBy links between them), and SECTIONS: the headings the site has
already laid out, each with the facts it is about to list under that heading.

Write ONE short paragraph for each section, in the order given. Each paragraph
introduces its section: it says what the reader should take from those facts and
why they hang together. The facts themselves are already on screen directly below
your paragraph, so do not re-list them.

Rules, in order of importance:

1. Use ONLY entities and relationships present in the subgraph and that section's
   facts. Never introduce an organisation, project, output, date or number that is
   not there. If a section is thin, say so plainly rather than padding.
2. Wrap every entity name in **double asterisks**, spelled exactly as it appears in
   the data — the site turns these into clickable graph links, and a misspelling
   silently breaks the link. Two or three named entities per paragraph is plenty.
3. **Hard limit: 50 words per paragraph.** Aim for 30–45. One or two sentences.
4. Do not repeat the section heading, and do not open with "This section" or
   "Here". Start with the substance.
5. Each paragraph must say something the list below it does not — the pattern, the
   significance, how the pieces relate. If you can only restate the list, write one
   short sentence rather than padding to length.
6. Tone: professional, plain and readable — a knowledgeable colleague explaining
   the landscape. Not marketing copy, not casual.
7. British spelling ("organisation", "programme").

Reply with JSON only — no markdown fence, no commentary — in exactly this shape,
echoing each heading back exactly as given:

{"sections":[{"heading":"<heading exactly as given>","paragraph":"<your paragraph>"}]}`;

/* Claude supports a response schema outright; Gemini gets the shape via JSON mode
   plus the instruction above, which keeps the request surface small. */
const CLAUDE_SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          paragraph: { type: "string" },
        },
        required: ["heading", "paragraph"],
        additionalProperties: false,
      },
    },
  },
  required: ["sections"],
  additionalProperties: false,
};

let workingModel = null; // remembered for the life of a warm instance

async function callGemini(userText) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    const e = new Error("GEMINI_API_KEY is not set");
    e.status = 503;
    throw e;
  }
  // known-good model first, but always keep the others as fallbacks behind it
  const candidates = workingModel
    ? [workingModel, ...GEMINI_MODELS.filter((m) => m !== workingModel)]
    : GEMINI_MODELS;

  let lastErr;
  for (const model of candidates) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: userText }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.4,
            maxOutputTokens: 2048,
          },
        }),
      },
    );

    if (r.ok) {
      if (workingModel !== model) console.log("ask: using gemini model", model);
      workingModel = model;
      const j = await r.json();
      return (j?.candidates?.[0]?.content?.parts || [])
        .map((p) => p.text || "")
        .join("")
        .trim();
    }

    const body = await r.text().catch(() => "");
    lastErr = new Error(`gemini ${r.status} (${model}): ${body.slice(0, 300)}`);
    lastErr.status = r.status;
    // 404 means this model is gone — try the next. Anything else is a real
    // problem (bad key, quota, malformed request) and applies to all of them.
    if (r.status !== 404) throw lastErr;
    if (workingModel === model) workingModel = null;
  }
  throw lastErr;
}

async function callClaude(userText) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const message = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4000, // caps thinking + prose together — thinking is on by default
    system: SYSTEM,
    // short scoped task; raise effort to "medium" for richer prose
    output_config: { effort: "low", format: { type: "json_schema", schema: CLAUDE_SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content: userText }],
  });
  if (message.stop_reason === "refusal") {
    const e = new Error("refused");
    e.status = 422;
    throw e;
  }
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// tolerant: models occasionally wrap JSON in a markdown fence even when told not to
function parseSections(text) {
  let t = (text || "").trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1].trim();
  let parsed;
  try {
    parsed = JSON.parse(t);
  } catch {
    return null;
  }
  if (!parsed || !Array.isArray(parsed.sections)) return null;
  const out = parsed.sections
    .filter((s) => s && typeof s.heading === "string" && typeof s.paragraph === "string")
    // belt-and-braces: the word cap is a prompt instruction, so clamp it here too
    .map((s) => ({
      heading: s.heading.slice(0, 120),
      paragraph: s.paragraph.trim().split(/\s+/).slice(0, 60).join(" "),
    }));
  return out.length ? out : null;
}

export default async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!sameSite(req)) {
    return Response.json({ error: "forbidden_origin" }, { status: 403 });
  }

  const ip = req.headers.get("x-nf-client-connection-ip") || "unknown";
  if (rateLimited(ip)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  let body;
  try {
    const raw = await req.text();
    if (raw.length > 60_000) {
      return Response.json({ error: "payload_too_large" }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const question = String(body?.question || "").slice(0, 500);
  const subgraph = body?.subgraph;
  const sections = Array.isArray(body?.sections) ? body.sections.slice(0, 8) : [];
  if (!question || !subgraph || !sections.length) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const userText =
    `Question: ${question}\n\n` +
    `SUBGRAPH:\n${JSON.stringify(subgraph)}\n\n` +
    `SECTIONS (write one paragraph for each, in this order):\n` +
    JSON.stringify(sections);

  const key = hashKey(`${PROVIDER}|${GEMINI_MODELS.join(",")}|${CLAUDE_MODEL}|${userText}`);
  const cached = cacheGet(key);
  if (cached) {
    return Response.json(
      { sections: cached, cached: true },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const text = PROVIDER === "claude" ? await callClaude(userText) : await callGemini(userText);
    if (!text) return Response.json({ error: "empty" }, { status: 502 });

    const out = parseSections(text);
    if (!out) return Response.json({ error: "bad_model_output" }, { status: 502 });

    cacheSet(key, out);
    return Response.json({ sections: out }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    // Never leak key material or internals to the page.
    console.error("ask failed:", PROVIDER, err?.status, err?.message);
    const status = err?.status === 429 ? 429 : err?.status === 503 ? 503 : 502;
    return Response.json({ error: "upstream_error" }, { status });
  }
};

export const config = { path: "/api/ask" };
