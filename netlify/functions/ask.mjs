/**
 * CBEDSync "Ask the graph" — LLM narrative proxy.
 *
 * The browser does the retrieval (it already holds the whole graph) and posts a
 * subgraph here; this function adds the API key and asks Claude to narrate it.
 * The key lives only in Netlify's environment — never in the page.
 *
 * Set ANTHROPIC_API_KEY in: Netlify → Site configuration → Environment variables.
 */

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

/* Only our own pages may call this. Add any custom domain here once it's live. */
const ALLOWED_HOSTS = [
  "cbedsync.netlify.app",
  "cbeds.netlify.app",
  "localhost",
  "127.0.0.1",
];

/* Crude per-IP throttle. Serverless instances don't share memory, so this blunts
   casual abuse rather than preventing it — the real backstop is a spend limit in
   the Anthropic Console. */
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

Return one entry per section, echoing the heading back exactly as given.`;

/* Structured output keeps the reply keyed to the headings the page already rendered. */
const SCHEMA = {
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

  try {
    const message = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 4000, // caps thinking + prose together — thinking is on by default
      system: SYSTEM,
      // short scoped task; raise effort to "medium" for richer prose
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [
        {
          role: "user",
          content:
            `Question: ${question}\n\n` +
            `SUBGRAPH:\n${JSON.stringify(subgraph)}\n\n` +
            `SECTIONS (write one paragraph for each, in this order):\n` +
            JSON.stringify(sections),
        },
      ],
    });

    if (message.stop_reason === "refusal") {
      return Response.json({ error: "refused" }, { status: 422 });
    }

    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (!text) return Response.json({ error: "empty" }, { status: 502 });

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return Response.json({ error: "bad_model_output" }, { status: 502 });
    }
    if (!parsed || !Array.isArray(parsed.sections)) {
      return Response.json({ error: "bad_model_output" }, { status: 502 });
    }

    // belt-and-braces: the word cap is a prompt instruction, so clamp it here too
    const out = parsed.sections
      .filter((s) => s && typeof s.heading === "string" && typeof s.paragraph === "string")
      .map((s) => ({
        heading: s.heading.slice(0, 120),
        paragraph: s.paragraph.trim().split(/\s+/).slice(0, 60).join(" "),
      }));

    if (!out.length) return Response.json({ error: "empty" }, { status: 502 });

    return Response.json(
      { sections: out },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err) {
    // Never leak key material or internals to the page.
    console.error("ask failed:", err?.status, err?.message);
    const status = err?.status === 429 ? 429 : 502;
    return Response.json({ error: "upstream_error" }, { status });
  }
};

export const config = { path: "/api/ask" };
