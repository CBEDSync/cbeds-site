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

const SYSTEM = `You are writing short narrative answers for CBEDSync, the knowledge graph of the
UK built-environment data-sharing ecosystem, run by CBEDS at UCL.

You will be given a user's question and a SUBGRAPH: the agents (organisations and
experts), projects, outputs and value themes the site retrieved for that question,
plus the managedBy / producedBy links between them.

Write a brief narrative that explains what the subgraph shows. The subgraph carries
a "narrative_shape" field naming which of these to follow — use it unless the
question plainly calls for another:

- "landscape" — Ecosystem landscape, for broad "who works on X?" questions. Group
  the agents by the role their listed type implies (universities and research
  institutes, industry and consultancies, standards bodies and regulators), then
  say where those groups meet: the best-connected project and the newest output.
- "trail" — Impact and delivery trail, when the question is about results. Open on
  what the work is for (its value themes), then the initiatives under way, then who
  is named as running or producing them, then what has actually been published.
- "web" — Collaborative web, when the question spans two or more topics. Centre on
  what they have in common: which partners bridge them, which technologies run
  through both, and the specific projects and outputs they share.

Rules, in order of importance:

1. Use ONLY entities and relationships present in the subgraph. Never introduce an
   organisation, project, output, date or fact that is not in it. If the subgraph is
   thin, say so plainly rather than padding.
2. Wrap every entity name in **double asterisks**, spelled exactly as it appears in
   the subgraph — the site turns these into clickable graph links, and a misspelling
   silently breaks the link.
3. When you single out an entity, say why it stands out using the data given
   (most connected, most recent, produced by several partners). Never imply that
   unnamed entities are inactive or less important.
4. Keep it to 120–200 words in 2–4 short paragraphs. No headings, no bullet lists,
   no preamble like "Here is" or "Based on the data".
5. Tone: professional, plain and readable — a knowledgeable colleague explaining
   the landscape. Not marketing copy, not casual.
6. British spelling ("organisation", "programme").`;

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
  if (!question || !subgraph) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const message = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 4000, // caps thinking + prose together — thinking is on by default
      system: SYSTEM,
      output_config: { effort: "low" }, // short scoped task; raise to "medium" for richer prose
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [
        {
          role: "user",
          content:
            `Question: ${question}\n\n` +
            `SUBGRAPH:\n${JSON.stringify(subgraph)}`,
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

    return Response.json(
      { text },
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
