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

You write two different things, and they must not be confused with each other.

FIRST, a CONTEXT of 2-3 sentences answering the question from your own general
knowledge, to orient a reader who does not know the subject. This one is NOT drawn
from the subgraph. Its own rules:

  C1. Explain the idea in plain terms: what it is, why it matters, what it is for.
      Write the way you would explain it to a colleague who works in the industry
      but not on this: short sentences, ordinary words, one idea at a time. British
      spelling ("organisation", "optimise", "programme"). Avoid the register of a
      consultancy deck - no "streamline", "robust", "seamless", "leverage",
      "holistic", "drive efficiencies", "across the value chain". If a sentence
      would survive being pasted into a brochure for a different subject, it is too
      vague to be worth showing.
  C2. Name NOTHING specific. No organisation, product, standard, version number,
      date, statistic or place. If you cannot make the point without naming one,
      make a more general point. This is absolute - the site presents everything
      else as verified CBEDS data, and an unverifiable name here would be read as
      part of it.
  C3. 60 words maximum. No asterisks, no markdown, no headings.
  C4. If the question is too vague to explain anything useful, return "" and the
      site will simply not show a context.

SECOND, the section paragraphs. These are NOT separate introductions to separate
sections. They are consecutive beats of ONE story answering what was asked, and the
reader meets them one after another with the facts listed in between. Write them in
the order given. The facts are already on screen directly below each paragraph, so
do not re-list them.

The site has already worked out which story this is and passes it as NARRATIVE
SHAPE. Follow that arc:

  trail     - what is being built here and what has come of it. Open on the work
              itself, move to who is behind it, then to what it has produced, and
              close on what that amounts to or what is conspicuously absent.
  landscape - who occupies this field and how the sectors meet. Open on who is
              here, move to where they actually come into contact, and close on
              what that pattern of contact means.
  web       - what two or more subjects have in common. Open on what each is doing
              separately, move to where they touch, and close on what the overlap
              makes possible that neither manages alone.

Rules, in order of importance:

0. Continuity is what makes this a story rather than a list.
   - Take up what an earlier beat established rather than reintroducing it: "those
     same standards bodies", "that gap", "the group behind it". A reader has just
     read the previous paragraph.
   - Never make a point an earlier beat has already made.
   - The LAST paragraph must land. It is the only one allowed to generalise, and it
     has to say what the whole thing adds up to, or name what is missing from it.
     Do not close on another list of names.
1. Use ONLY entities and relationships present in the subgraph and that section's
   facts. Never introduce an organisation, project, output, date or number that is
   not there. If a section is thin, say so plainly rather than padding.
2. **Name at least two specific entities in every paragraph — three where the facts
   allow.** The closing paragraph is the exception: it may name one, or none, if
   that is what it takes to say what the whole thing amounts to. Wrap each in **double asterisks**, spelled exactly as it appears in the
   data: the site turns these into clickable graph links, and a misspelling silently
   breaks the link. Naming nobody is a failed paragraph. Write concretely:
   "**University of Cambridge** works alongside **Connected Places Catapult**",
   never "academic institutions work with industry providers".
3. **Hard limit: 50 words per paragraph.** Aim for 30–45. One or two sentences.
4. Do not repeat the section heading, and do not open with "This section" or
   "Here". Start with the substance.
5. Each paragraph must say something the list below it does not — the pattern, the
   significance, how the pieces relate. Show that pattern *through* the named
   entities rather than describing it in the abstract. If you can only restate the
   list, write one short sentence rather than padding to length.
6. Tone: professional, plain and readable — a knowledgeable colleague explaining
   the landscape. Not marketing copy, not casual.
7. British spelling ("organisation", "programme").

Reply with JSON only — no markdown fence, no commentary — in exactly this shape,
echoing each heading back exactly as given:

{"context":"<your 2-3 general sentences, or \"\">","sections":[{"heading":"<heading exactly as given>","paragraph":"<your paragraph>"}]}`;

/* Claude supports a response schema outright; Gemini gets the shape via JSON mode
   plus the instruction above, which keeps the request surface small. */
const CLAUDE_SCHEMA = {
  type: "object",
  properties: {
    context: { type: "string" },
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
  required: ["context", "sections"],
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
function parseSections(text, question) {
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
  if (!out.length) return null;
  return { context: cleanContext(parsed.context, question), sections: out };
}

/* The context is the one thing here written from the model's own knowledge rather
   than from the workbook, so it is checked rather than trusted. Rule C2 says name
   nothing specific; a model that ignores it would put an unverifiable organisation
   on a page where everything else is verified CBEDS data, so anything that looks
   like a name or a figure costs the whole block. Dropping it is free - the site
   simply shows no context. */
const NAMEY = [
  /\b\d/,                                  // any digit: years, versions, statistics
  /\*/,                                     // markdown emphasis, i.e. an entity link
  /\b(?:ISO|IEC|EN|BS|IFC|BIM|CEN|ETIM|GS1|UNECE|EU|UK|US)\b/,
  /\b[A-Z]{2,}\b/,                          // any other acronym
  /\b(?:Ltd|LLC|plc|GmbH|University|Institute|Council|Commission|Consortium)\b/i,
];
function cleanContext(v, question) {
  if (typeof v !== "string") return "";
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.split(" ").length > 70) return "";          // C3, with a little slack

  /* Words the reader typed are theirs, not the model's. Without this the checks fire
     on the subject of the question itself - ask about IFC or DPPs and the answer
     cannot say "IFC" - which suppressed the background on exactly the acronym
     questions the ask box says it understands. Echoing someone's own term back is
     not an unverifiable claim; inventing a new one still is, so only the words
     actually asked about are exempt. */
  const asked = new Set(
    String(question || "").toLowerCase().match(/[a-z0-9][a-z0-9.\-]*/g) || [],
  );
  const probe = t.replace(/[A-Za-z0-9][A-Za-z0-9.\-]*/g, (w) =>
    asked.has(w.toLowerCase()) ? "thing" : w,
  );

  if (NAMEY.some((re) => re.test(probe))) return "";
  // a capitalised word mid-sentence is very likely a proper noun
  if (/[a-z,] [A-Z][a-z]{2,}/.test(probe)) return "";
  return t;
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

  /* A question the page could not match never gets this far as a normal request -
     there is no subgraph to gloss - so the only record that anyone asked it is this
     line. Text only: no address, no identifier, nothing joined to anything. Read it
     under Netlify > Functions > ask > Logs, or `netlify logs:function ask`. Behind
     the origin and rate-limit guards above, so it cannot be written from elsewhere. */
  const miss = String(body?.miss || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (miss) {
    console.log("ask miss:", JSON.stringify(miss));
    return new Response(null, { status: 204 });
  }

  const question = String(body?.question || "").slice(0, 500);
  const subgraph = body?.subgraph;
  const sections = Array.isArray(body?.sections) ? body.sections.slice(0, 8) : [];
  if (!question || !subgraph || !sections.length) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  /* The client already decides which of the three stories fits the question, and
     used to ship that decision buried in the subgraph JSON where the prompt never
     looked at it. Stated plainly here instead, and only ever one of the three the
     prompt defines - it arrives from the page, so it is not pasted in unchecked. */
  const SHAPES = ["trail", "landscape", "web"];
  const shape = SHAPES.includes(subgraph?.narrative_shape) ? subgraph.narrative_shape : "landscape";

  const userText =
    `Question: ${question}\n\n` +
    `NARRATIVE SHAPE: ${shape}\n\n` +
    `SUBGRAPH:\n${JSON.stringify(subgraph)}\n\n` +
    `SECTIONS — these are the beats of one story, in order. The last one closes it:\n` +
    JSON.stringify(sections);

  const key = hashKey(`${PROVIDER}|${GEMINI_MODELS.join(",")}|${CLAUDE_MODEL}|${userText}`);
  const cached = cacheGet(key);
  if (cached) {
    return Response.json(
      { ...cached, cached: true },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const text = PROVIDER === "claude" ? await callClaude(userText) : await callGemini(userText);
    if (!text) return Response.json({ error: "empty" }, { status: 502 });

    const out = parseSections(text, question);
    if (!out) return Response.json({ error: "bad_model_output" }, { status: 502 });

    cacheSet(key, out);
    return Response.json(out, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    // Never leak key material or internals to the page.
    console.error("ask failed:", PROVIDER, err?.status, err?.message);
    const status = err?.status === 429 ? 429 : err?.status === 503 ? 503 : 502;
    return Response.json({ error: "upstream_error" }, { status });
  }
};

export const config = { path: "/api/ask" };
