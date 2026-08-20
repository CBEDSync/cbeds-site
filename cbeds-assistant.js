/**
 * CBEDS "Ask the graph" assistant — shared engine.
 *
 * Retrieval, narrative shaping and the LLM upgrade live here, so CBEDSync and
 * CBEDSense answer identically. Everything page-specific — what a node click
 * does, what hovering does, how it's styled — arrives through options.
 *
 *   var X = CBEDSAssistant.buildIndex(window.CBEDS_DATA);
 *   CBEDSAssistant.create({
 *     index: X,
 *     log: <element>, input: <input>, send: <button>, clear: <button|null>,
 *     onEntityClick: function (node) { ... },     // required
 *     onEntityHover: function (node, entering) { ... },
 *     onAnswer: function (info) { ... },          // {sg, centerNode, shape}
 *     onNoMatch: function () { ... },
 *     onClear: function () { ... }
 *   });
 *
 * The markup it emits (.narr, .nsec, .nsum, .ent, .more, .msg) carries no colour
 * of its own — each page styles those classes for its own theme.
 */
(function (global) {
  "use strict";

  function esc(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ---------------------------------------------------------------- index -- */
  function buildIndex(D) {
    var ENT = D.nodes || [];
    var techSet = {};
    ENT.forEach(function (n) {
      (n.tech || []).forEach(function (t) {
        var k = t.trim();
        if (k) techSet[k] = 1;
      });
    });
    Object.keys(D.techcat || {}).forEach(function (t) {
      techSet[t.trim()] = 1;
    });
    var TECH = Object.keys(techSet).map(function (t) {
      return {
        id: t, kind: "tech",
        sub: (D.techcat[t] || D.techcat[t + " "] || "Technology"),
        desc: "Technology used across the ecosystem.",
        themes: [], stages: [], tech: [], rel: [],
      };
    });
    var NODES = ENT.concat(TECH);
    var byId = {};
    NODES.forEach(function (n) { byId[n.id] = n; });

    var adj = {};
    function addAdj(a, b, t, dir) {
      if (!adj[a]) adj[a] = [];
      if (!adj[a].some(function (x) { return x.id === b && x.t === t; }))
        adj[a].push({ id: b, t: t, dir: dir });
    }
    ENT.forEach(function (n) {
      (n.rel || []).forEach(function (r) {
        if (byId[r.n]) { addAdj(n.id, r.n, r.t, "out"); addAdj(r.n, n.id, r.t, "in"); }
      });
      (n.tech || []).forEach(function (t) {
        var k = t.trim();
        if (byId[k]) { addAdj(n.id, k, "tech", "out"); addAdj(k, n.id, "tech", "in"); }
      });
    });
    var degOf = {};
    NODES.forEach(function (n) { degOf[n.id] = (adj[n.id] || []).length; });

    // acronym / synonym map -> technology id, from names like "Digital Product Passport (DPP)"
    var ABBR = {};
    TECH.forEach(function (t) {
      var m = t.id.match(/\(([^)]+)\)/);
      if (m) m[1].split(/[\/,]/).forEach(function (ab) {
        var k = ab.trim().toLowerCase();
        if (k) ABBR[k] = t.id;
      });
    });
    function findTech(sub) {
      for (var i = 0; i < TECH.length; i++)
        if (TECH[i].id.toLowerCase().indexOf(sub) >= 0) return TECH[i].id;
      return null;
    }
    [["product passport", "digital product passport"], ["material passport", "material passport"],
     ["digital twin", "digital twin"], ["linked data", "linked data"], ["ontology", "ontolog"],
     ["ontologies", "ontolog"], ["data space", "data space"], ["data spaces", "data space"],
     ["common data environment", "common data environment"],
     ["building information model", "building information model"],
     ["building information modelling", "building information model"],
     ["logbook", "logbook"], ["building permit", "permit"]].forEach(function (p) {
      var id = findTech(p[1]);
      if (id) ABBR[p[0]] = id;
    });

    return {
      D: D, ENT: ENT, TECH: TECH, NODES: NODES, byId: byId, adj: adj, degOf: degOf, ABBR: ABBR,
      kindLabel: { agent: "Agent", project: "Project", output: "Output", tech: "Technology" },
      kindColors: { agent: "#3a8fd6", project: "#36c9b8", output: "#86cf5e", tech: "#e0a23c" },
      kindColor: function (k) { return this.kindColors[k] || "#7e98a0"; },
      relLabel: { partOf: "Part of", managedBy: "Managed by", producedBy: "Produced by", link: "Links to", tech: "Uses" },
      relLabelIn: { partOf: "Includes", managedBy: "Manages", producedBy: "Produces", link: "Linked from", tech: "Used by" },
    };
  }

  /* ------------------------------------------------------------- instance -- */
  function create(opts) {
    var X = opts.index || buildIndex(opts.data || global.CBEDS_DATA);
    var D = X.D, NODES = X.NODES, TECH = X.TECH, byId = X.byId, adj = X.adj,
        degOf = X.degOf, ABBR = X.ABBR, kindLabel = X.kindLabel;
    var log = opts.log, input = opts.input, sendBtn = opts.send, clearBtn = opts.clear;
    var ENDPOINT = opts.endpoint || "/api/ask";
    var GREETING = opts.greeting ||
      "Ask a question — “who works on Digital Twin?”, “show outputs about circularity”, or type any name. " +
      "I follow the connections two hops out and summarise what the graph holds.";
    var noop = function () {};
    var onEntityClick = opts.onEntityClick || noop;
    var onEntityHover = opts.onEntityHover || null;
    var onAnswer = opts.onAnswer || noop;
    var onNoMatch = opts.onNoMatch || noop;
    var onClear = opts.onClear || noop;

    /* -- question interpretation -- */
    function resolveTopic(s) {
      var words = s.split(/[^a-z0-9]+/).filter(Boolean);
      for (var i = 0; i < words.length; i++)
        if (ABBR[words[i]] && byId[ABBR[words[i]]]) return byId[ABBR[words[i]]];
      for (var k in ABBR)
        if (k.indexOf(" ") >= 0 && s.indexOf(k) >= 0 && byId[ABBR[k]]) return byId[ABBR[k]];
      var best = null, bl = 0;
      TECH.forEach(function (t) {
        var nm = t.id.toLowerCase().replace(/\s*\([^)]*\)/, "").trim();
        if (nm.length > 3 && s.indexOf(nm) >= 0 && nm.length > bl) { best = t; bl = nm.length; }
      });
      if (best) return best;
      for (var j = 0; j < (D.themes || []).length; j++) {
        var parts = D.themes[j].toLowerCase().split(" and ");
        for (var p = 0; p < parts.length; p++) {
          var w = parts[p].trim();
          if (w.length > 6 && s.indexOf(w) >= 0) return { theme: D.themes[j] };
        }
      }
      var stem = themeByStem(s);
      if (stem) return { theme: stem };
      var nm2 = null;
      NODES.forEach(function (n) {
        if (n.kind !== "tech") {
          var id = n.id.toLowerCase();
          if (id.length > 5 && s.indexOf(id) >= 0 && (!nm2 || id.length > nm2.id.length)) nm2 = n;
        }
      });
      return nm2 || resolveLoose(s);
    }

    /* Every pass above needs the question to contain a name outright, and the last
       resort in respond() looks for the whole question inside a name, which is worse.
       So "what is digital passport?" found nothing: the entry is "Digital Product
       Passport (DPP)" and nobody says the middle word. This scores each name by how
       much of it the question actually said, which is the way people ask. */
    var STOP = {};
    ("what which where when whose why how who does did do is are was were be been the "
     + "a an of in on for to and or with about from at as by that this it its can could "
     + "would should tell me you please explain define mean means give show find list "
     + "any some more most work works working used use using"
    ).split(" ").forEach(function (w) { STOP[w] = 1; });

    function sigWords(t) {
      var out = [], seen = {};
      t.toLowerCase().split(/[^a-z0-9]+/).forEach(function (w) {
        if (w.length > 2 && !STOP[w] && !seen[w]) { seen[w] = 1; out.push(w); }
      });
      return out;
    }
    /* "circular economy" is how people say the Sustainability and Circularity theme,
       and the containment pass above cannot see it: the theme's word is the LONGER of
       the two, so the question never contains it. Comparing stems catches that pair,
       and interoperable/interoperability, and sustainable/sustainability. Where a
       question touches two themes the earlier word wins, on the grounds that people
       lead with their subject - "circular economy in construction" is about the first.
       Six characters is short enough to stem and long enough not to collide. */
    function themeByStem(s) {
      var qw = sigWords(s), best = null, bestAt = 1e9;
      (D.themes || []).forEach(function (theme) {
        theme.toLowerCase().split(/ and |,/).forEach(function (part) {
          var tw = part.trim();
          if (tw.length < 6) return;
          for (var i = 0; i < qw.length; i++) {
            if (qw[i].length >= 5 && qw[i].slice(0, 6) === tw.slice(0, 6) && i < bestAt) {
              bestAt = i; best = theme;
            }
          }
        });
      });
      return best;
    }
    /* Last resort before giving up. This used to look for the ENTIRE question inside a
       name or description, which no sentence ever satisfies, so anything not naming a
       topic outright died here. It now scores entries word by word.

       Rare words carry the query: "steel" narrows to a handful of entries, "data"
       narrows to nothing, so each word is worth log(total / how many entries use it),
       and double that when it lands in the name rather than the blurb. The floor stops
       one very common word dragging back half the graph. 1,256 of the 1,596 entries
       carry a description, so there is real text here to search. */
    var MISS_FLOOR = 2.0;
    function searchText(s) {
      var qw = sigWords(s);
      if (!qw.length) return [];
      var df = {}, texts = [];
      qw.forEach(function (w) { df[w] = 0; });
      NODES.forEach(function (n) {
        var t = (n.id + " " + (n.desc || "")).toLowerCase();
        texts.push(t);
        qw.forEach(function (w) { if (t.indexOf(w) >= 0) df[w]++; });
      });
      var scored = [];
      NODES.forEach(function (n, i) {
        var t = texts[i], score = 0;
        qw.forEach(function (w) {
          if (!df[w] || t.indexOf(w) < 0) return;
          var weight = Math.log(NODES.length / df[w]);
          if (n.id.toLowerCase().indexOf(w) >= 0) weight *= 2;
          score += weight;
        });
        if (score > 0) scored.push({ n: n, score: score });
      });
      if (!scored.length) return [];
      scored.sort(function (a, b) {
        return b.score - a.score || (degOf[b.n.id] || 0) - (degOf[a.n.id] || 0);
      });
      if (scored[0].score < MISS_FLOOR) return [];
      return scored.slice(0, 40).map(function (x) { return x.n; });
    }

    /* When even that finds nothing, name the nearest topics rather than repeating the
       same generic hint. A dead end the reader can act on. */
    function nearestTopics(s) {
      var qw = sigWords(s), out = [];
      if (!qw.length) return out;
      var cands = TECH.map(function (t) { return t.id; }).concat(D.themes || []);
      cands.forEach(function (name) {
        var tw = sigWords(name.replace(/\s*\([^)]*\)/, " ")), hit = 0;
        tw.forEach(function (w) {
          qw.forEach(function (q) { if (w.slice(0, 6) === q.slice(0, 6)) hit++; });
        });
        if (hit) out.push({ name: name, hit: hit });
      });
      out.sort(function (a, b) { return b.hit - a.hit; });
      return out.slice(0, 3).map(function (x) { return x.name; });
    }

    function resolveLoose(s) {
      var asked = {}, n = 0;
      sigWords(s).forEach(function (w) { asked[w] = 1; n++; });
      if (!n) return null;
      var best = null, bestCover = 0, bestDeg = -1;
      NODES.forEach(function (node) {
        var t = sigWords(node.id.replace(/\s*\([^)]*\)/, " "));
        if (!t.length) return;
        var hit = 0;
        t.forEach(function (w) { if (asked[w]) hit++; });
        if (!hit) return;
        // how much of the NAME was said, not how much of the question was used: asking
        // a long question about one thing should still find that thing
        var cover = hit / t.length;
        if (cover < 0.6) return;                 // "digital" alone must not summon Digital Twin
        // a single word carries a name only when the name is that one word
        if (hit === 1 && !(t.length === 1 && t[0].length > 5)) return;
        var deg = degOf[node.id] || 0;
        if (cover > bestCover || (cover === bestCover && deg > bestDeg)) {
          bestCover = cover; bestDeg = deg; best = node;
        }
      });
      return best;
    }
    function resolveTopics(s) {
      var found = [], ids = {};
      function push(id) { if (byId[id] && !ids[id]) { ids[id] = 1; found.push(byId[id]); } }
      s.split(/[^a-z0-9]+/).filter(Boolean).forEach(function (w) { if (ABBR[w]) push(ABBR[w]); });
      for (var k in ABBR) if (k.indexOf(" ") >= 0 && s.indexOf(k) >= 0) push(ABBR[k]);
      TECH.forEach(function (t) {
        var nm = t.id.toLowerCase().replace(/\s*\([^)]*\)/, "").trim();
        if (nm.length > 3 && s.indexOf(nm) >= 0) push(t.id);
      });
      return found;
    }
    function typePred(s) {
      if (/\bstandard/.test(s)) return [function (n) { return n.kind === "output" && /standard/i.test(n.sub || ""); }, "standards"];
      if (/\bschema/.test(s)) return [function (n) { return n.kind === "output" && /schema/i.test(n.sub || ""); }, "schemas"];
      if (/\breport/.test(s)) return [function (n) { return n.kind === "output" && /report/i.test(n.sub || ""); }, "reports"];
      if (/\b(tool|system|software|platform)/.test(s)) return [function (n) { return n.kind === "output" && /system/i.test(n.cls || ""); }, "tools / systems"];
      if (/\b(output|document)/.test(s)) return [function (n) { return n.kind === "output"; }, "outputs"];
      if (/\b(organisation|organization|\borg\b|agent|compan|institution|\bwho\b|expert)/.test(s)) return [function (n) { return n.kind === "agent"; }, "organisations & experts"];
      if (/\b(project|initiative|working group|committee)/.test(s)) return [function (n) { return n.kind === "project"; }, "projects"];
      if (/\btechnolog/.test(s)) return [function (n) { return n.kind === "tech"; }, "technologies"];
      return null;
    }

    /* -- subgraph: hop 2 via managedBy / producedBy is where the story lives, because
          technology links are flat tags with no internal structure -- */
    function roleOf(n) {
      var s = n.sub || ""; // build.py truncates sub at 60 chars, so match by prefix
      if (/^Academic/i.test(s)) return "academic";
      if (/Regulator|Standard Bod/i.test(s)) return "standards";
      if (/^Developers|^Industry|^Designers|^Consultant/i.test(s)) return "industry";
      return "other";
    }
    function byDeg(a, b) { return (degOf[b.id] || 0) - (degOf[a.id] || 0); }
    function subgraphFromNodes(list, anchors) {
      var sg = { anchors: anchors || [], agent: [], project: [], output: [], tech: [], chains: [], themes: {}, ids: {} }, seen = {};
      list.forEach(function (n) {
        if (!n || seen[n.id]) return;
        seen[n.id] = 1; sg[n.kind].push(n); sg.ids[n.id] = 1;
        (n.themes || []).forEach(function (t) { sg.themes[t] = (sg.themes[t] || 0) + 1; });
      });
      sg.project.concat(sg.output).forEach(function (x) {
        (adj[x.id] || []).forEach(function (e) {
          if (e.dir !== "out" || (e.t !== "managedBy" && e.t !== "producedBy")) return;
          var ag = byId[e.id];
          if (!ag || ag.kind !== "agent") return;
          sg.chains.push({ via: x, rel: e.t, agent: ag }); sg.ids[ag.id] = 1;
          if (!seen[ag.id]) { seen[ag.id] = 1; sg.agent.push(ag); }
        });
      });
      ["agent", "project", "output", "tech"].forEach(function (k) { sg[k].sort(byDeg); });
      (anchors || []).forEach(function (a) { sg.ids[a.id] = 1; });
      return sg;
    }

    /* -- phrasing helpers -- */
    function entLink(n) { return '<a class="ent" data-id="' + esc(n.id) + '">' + esc(n.id) + "</a>"; }
    function listPhrase(a) { return a.length > 1 ? a.slice(0, -1).join(", ") + " and " + a[a.length - 1] : (a[0] || ""); }
    var MORE = {}, moreSeq = 0;
    function expandable(parts, max, mode) {
      var join = function (a) { return mode === "semi" ? a.join("; ") : listPhrase(a); };
      if (parts.length <= max) return join(parts);
      var id = "m" + (++moreSeq);
      MORE[id] = { parts: parts, mode: mode };
      return '<span class="exp" data-exp="' + id + '">' + join(parts.slice(0, max)) +
             ' <a class="more" data-exp="' + id + '">(+' + (parts.length - max) + " more)</a></span>";
    }
    function joinEnts(arr, max) { return expandable(arr.map(entLink), max, "list"); }
    function yearOf(n) { var m = (n.year || "").match(/\d{4}/); return m ? +m[0] : 0; }
    function countOf(n, w) { return "<b>" + n + "</b> " + w + (n === 1 ? "" : "s"); }
    var LENS_KEY = { "organisations & experts": "agent", projects: "project", technologies: "tech" };
    var OUT_LABEL = { Report: "report", Standard: "standard", Schema: "schema", Standalone: "software tool", Data: "dataset", Connecting: "connected system" };

    /* -- three narrative shapes, routed by what the question is after --
          landscape = who is in this field and how the sectors meet
          trail     = what is being built and what has come out of it
          web       = what two or more topics have in common
       Wording decides when the question is explicit; most questions are a bare name
       with no signal, so the retrieved subgraph gets the casting vote rather than
       everything defaulting to one shape. "share"/"link" are deliberately NOT web
       triggers: "data sharing" and "linked data" are everywhere in this domain. */
    var TRAIL_LENS = { standards: 1, schemas: 1, reports: 1, "tools / systems": 1, outputs: 1, projects: 1 };
    function shapeSignals(sg) {
      var seen = {}, roles = 0;
      sg.agent.forEach(function (n) { seen[roleOf(n)] = 1; });
      ["academic", "industry", "standards"].forEach(function (k) { if (seen[k]) roles++; });
      return { a: sg.agent.length, p: sg.project.length, o: sg.output.length, roles: roles,
               anchor: sg.anchors.length === 1 ? sg.anchors[0].kind : null };
    }
    function pickShape(sg, tp, s) {
      s = s || "";
      var lens = tp ? tp[1] : null;
      if (sg.anchors.length > 1 || /\b(in common|both|between|versus|vs|overlap\w*|bridge\w*|intersect\w*)\b/.test(s)) return "web";
      if (lens && TRAIL_LENS[lens]) return "trail";
      if (lens === "organisations & experts") return "landscape";
      // "produce" spelled out rather than produc\w* — otherwise "Digital Product Passport" matches
      if (/\b(produce[sd]?|producing|production|deliver\w*|publish\w*|outcome\w*|result\w*|achiev\w*|built|made)\b/.test(s)) return "trail";
      // the plainest way to ask for a trail, and the list above misses all of it
      if (/\b(?:come|comes|came|coming)\s+(?:out\s+)?(?:of|from)\b/.test(s)) return "trail";
      var f = shapeSignals(sg);
      if (f.anchor === "agent" || f.anchor === "project") return "trail";  // a body: the story is what it delivers
      if (f.a >= 4 && f.roles >= 2) return "landscape";                    // a real spread of sectors to describe
      return (f.o + f.p) > 0 ? "trail" : "landscape";
    }
    function narrFacts(sg) {
      var g = { academic: [], industry: [], standards: [], other: [] }, runBy = {}, prodBy = {};
      sg.agent.forEach(function (n) { g[roleOf(n)].push(n); });
      sg.chains.forEach(function (c) {
        if (c.via.kind === "project" && !runBy[c.via.id]) runBy[c.via.id] = c.agent;
        if (c.via.kind === "output" && !prodBy[c.via.id]) prodBy[c.via.id] = c.agent;
      });
      var bySub = {};
      sg.output.forEach(function (o) { var k = o.sub || "Output"; bySub[k] = (bySub[k] || 0) + 1; });
      return {
        g: g, runBy: runBy, prodBy: prodBy,
        mix: Object.keys(bySub).sort(function (a, b) { return bySub[b] - bySub[a]; }).slice(0, 3)
          .map(function (k) { return countOf(bySub[k], OUT_LABEL[k] || k.toLowerCase()); }),
        dated: sg.output.filter(yearOf).sort(function (a, b) { return yearOf(b) - yearOf(a); }),
        themes: Object.keys(sg.themes).sort(function (a, b) { return sg.themes[b] - sg.themes[a]; }).slice(0, 3),
      };
    }
    function themePhrase(th) {
      return listPhrase(th.map(function (t) { return "<b>" + esc(t.replace(" and ", " & ").trim()) + "</b>"; }));
    }
    function leadCounts(sg) {
      var b = [];
      if (sg.agent.length) b.push("<b>" + sg.agent.length + "</b> organisation" + (sg.agent.length === 1 ? "" : "s") + " &amp; expert" + (sg.agent.length === 1 ? "" : "s"));
      if (sg.project.length) b.push(countOf(sg.project.length, "project"));
      if (sg.output.length) b.push(countOf(sg.output.length, "output"));
      return sg.anchors.length === 1 ? entLink(sg.anchors[0]) + " connects to " + listPhrase(b) + " in the graph."
           : sg.anchors.length > 1 ? "They share " + listPhrase(b) + "."
           : "That matches " + listPhrase(b) + ".";
    }
    function projectList(sg, f, from) {
      return expandable(sg.project.slice(from || 0).map(function (p) {
        var a = f.runBy[p.id];
        return entLink(p) + (a ? " (" + entLink(a) + ")" : "");
      }), 3, "semi");
    }
    function outputTail(sg, tp, f) {
      var lens = tp ? tp[1] : null, pool = sg.output;
      if (tp && !LENS_KEY[lens]) { var ff = sg.output.filter(tp[0]); if (ff.length && ff.length < sg.output.length) pool = ff; }
      var dated = pool.filter(yearOf).sort(function (a, b) { return yearOf(b) - yearOf(a); }), top = dated[0], h = "";
      if (top) h += "<p>The most recent is " + entLink(top) + " (" + esc(top.year) + (f.prodBy[top.id] ? ", from " + entLink(f.prodBy[top.id]) : "") + ").</p>";
      var rest = pool.filter(function (o) { return !top || o.id !== top.id; })
        .map(function (o) { var a = f.prodBy[o.id]; return entLink(o) + (o.year ? " (" + esc(o.year) + ")" : "") + (a ? " — " + entLink(a) : ""); });
      // very large sets stay browsable rather than dumping 500 links
      if (rest.length) h += "<p>" + (pool !== sg.output ? "Other " + esc(lens) : "Others") + " here" + (rest.length > 40 ? " include" : "") + ": " + expandable(rest.slice(0, 40), 3, "semi") + ".</p>";
      return h;
    }

    /* A — Ecosystem landscape: the sectors at work and where they meet */
    function narrLandscape(sg, tp, f) {
      var A = sg.agent, secs = [];
      if (A.length >= 2) {
        var body = "", span = [];
        if (f.g.academic.length) { span.push("research"); body += "<p><b>Universities and research institutes:</b> " + joinEnts(f.g.academic, 4) + ".</p>"; }
        if (f.g.industry.length) { span.push("industry"); body += "<p><b>Industry and consultancies:</b> " + joinEnts(f.g.industry, 4) + ".</p>"; }
        if (f.g.standards.length) { span.push("standards"); body += "<p><b>Standards bodies and regulators:</b> " + joinEnts(f.g.standards, 4) + ".</p>"; }
        if (!body && f.g.other.length) body = "<p>" + joinEnts(f.g.other, 5) + ".</p>";
        if (span.length > 1) body = "<p>The " + A.length + " organisations here span " + listPhrase(span) + ".</p>" + body;
        secs.push({ t: "Who is here", h: body });
      } else if (A.length) secs.push({ t: "Who is here", h: "<p>" + joinEnts(A, 5) + ".</p>" });
      var meet = "";
      if (sg.project.length) {
        var p = sg.project[0], a = f.runBy[p.id];
        meet += "<p>" + entLink(p) + (a ? ", run by " + entLink(a) + "," : "") + " is where most of that activity converges — " + countOf(degOf[p.id] || 0, "link") + " into the rest of the graph.</p>";
      }
      if (f.dated.length) {
        var o = f.dated[0];
        meet += "<p>The newest thing to come out of it is " + entLink(o) + " (" + esc(o.year) + (f.prodBy[o.id] ? ", from " + entLink(f.prodBy[o.id]) : "") + ").</p>";
      }
      if (meet) secs.push({ t: "Where they actually meet", h: meet });
      if (f.themes.length) secs.push({ t: "What that adds up to", h: "<p>Most of this work is tagged under " + themePhrase(f.themes) + ".</p>" });
      return secs;
    }

    /* B — Impact & delivery trail: why the field exists here, then what it has shipped */
    function narrTrail(sg, tp, f) {
      var secs = [];
      if (f.themes.length) secs.push({ t: "What this is trying to move", h: "<p>This work is tagged against " + themePhrase(f.themes) + " — that is what it is trying to move.</p>" });
      if (sg.project.length) {
        var p = sg.project[0], a = f.runBy[p.id];
        var h = "<p>" + entLink(p) + (a ? ", run by " + entLink(a) + "," : "") + " is the most connected initiative here, with " + countOf(degOf[p.id] || 0, "link") + " into the rest of the graph.</p>";
        if (sg.project.length > 1) h += "<p>Also under way: " + projectList(sg, f, 1) + ".</p>";
        secs.push({ t: "What is being built", h: h });
      }
      var players = [], seen = {};
      sg.chains.forEach(function (c) { if (!seen[c.agent.id]) { seen[c.agent.id] = 1; players.push(c.agent); } });
      if (players.length) secs.push({ t: "Who is behind it", h: "<p>" + joinEnts(players, 5) + (players.length === 1 ? " is" : " are") + " named as running or producing the items above.</p>" });
      else if (sg.agent.length) secs.push({ t: "Who is behind it", h: "<p>" + joinEnts(sg.agent, 5) + ".</p>" });
      /* A trail has to end on what came of it. Where nothing has, saying so IS the
         ending - without this the last beat was "Who is behind it", and no prompt can
         make a story land on a roll call of names. */
      if (sg.output.length) secs.push({ t: "What has come out", h: "<p>The record so far: " + listPhrase(f.mix) + ".</p>" + outputTail(sg, tp, f) });
      else secs.push({ t: "What has not come out yet", h: "<p>Nothing here is recorded as having produced a published output — what the graph holds is the organisations and the work under way, not results.</p>" });
      return secs;
    }

    /* C — Collaborative web: what the named topics have in common and who bridges them */
    function narrWeb(sg, tp, f) {
      var secs = [], body = "";
      if (f.g.academic.length && f.g.industry.length)
        body = "<p>Research and delivery meet here: " + joinEnts(f.g.academic, 3) + " on the academic side, " + joinEnts(f.g.industry, 3) + " on the commercial side.</p>";
      else if (sg.agent.length) body = "<p>" + joinEnts(sg.agent, 5) + " appear on every side of this.</p>";
      if (f.g.standards.length) body += "<p>Working to frameworks from " + joinEnts(f.g.standards, 3) + ".</p>";
      if (body) secs.push({ t: "Who is on each side", h: body });
      if (sg.tech.length) secs.push({ t: "Enabling technologies", h: "<p>" + joinEnts(sg.tech, 5) + " run through these entries as well.</p>" });
      var overlap = "";
      if (sg.project.length) overlap += "<p>Shared projects: " + projectList(sg, f, 0) + ".</p>";
      if (sg.output.length) overlap += "<p>Shared outputs: " + expandable(sg.output.map(function (o) { return entLink(o) + (o.year ? " (" + esc(o.year) + ")" : ""); }), 3, "semi") + ".</p>";
      if (overlap) secs.push({ t: "Where they touch", h: overlap });
      if (f.themes.length) secs.push({ t: "What the overlap makes possible", h: "<p>Most of this work is tagged under " + themePhrase(f.themes) + ".</p>" });
      return secs;
    }

    // build the sections once; render with or without the per-section LLM paragraphs
    function buildNarrative(sg, tp, shape) {
      var f = narrFacts(sg);
      var secs = (shape === "trail" ? narrTrail : shape === "web" ? narrWeb : narrLandscape)(sg, tp, f)
        .filter(function (x) { return x.h; });
      return { lead: "<p>" + leadCounts(sg) + "</p>", secs: secs, shape: shape };
    }
    function renderNarrative(n, paras) {
      var H = [n.lead];
      n.secs.forEach(function (x) {
        H.push('<div class="nsec">' + x.t + "</div>");
        if (paras && paras[x.t]) H.push('<p class="nsum">' + paras[x.t] + "</p>"); // gloss leads, facts follow
        H.push(x.h);
      });
      return '<div class="narr" data-shape="' + n.shape + '">' + H.join("") + "</div>";
    }

    function bindEnts(root) {
      if (!root) return;
      [].forEach.call(root.querySelectorAll(".ent"), function (a) {
        var t = byId[a.getAttribute("data-id")];
        if (t) a.onclick = function () { onEntityClick(t); };
        if (t && onEntityHover) {
          a.onmouseenter = function () { onEntityHover(t, true); };
          a.onmouseleave = function () { onEntityHover(t, false); };
        }
      });
      [].forEach.call(root.querySelectorAll("a.more"), function (a) {
        a.onclick = function () {
          var id = a.getAttribute("data-exp"), d = MORE[id];
          if (!d) return;
          var host = root.querySelector('span.exp[data-exp="' + id + '"]');
          if (!host) return;
          host.innerHTML = d.mode === "semi" ? d.parts.join("; ") : listPhrase(d.parts);
          bindEnts(host);
        };
      });
    }

    /* -- transcript: follow the answer as it reveals, handing control to the reader
          the moment they scroll up. Scrolling back to the bottom re-arms it. -- */
    var followBottom = true, lastScrollTop = 0, followSeq = 0;
    if (log) log.addEventListener("scroll", function () {
      var t = log.scrollTop;
      if (t < lastScrollTop - 1) followBottom = false;       // only we scroll down, so a decrease is the reader
      else if (log.scrollHeight - t - log.clientHeight < 40) followBottom = true;
      lastScrollTop = t;
    });
    function revealMs(el) { return 340 + Math.min(el.querySelectorAll(".narr>*").length, 11) * 60 + 140; }
    function followReveal(ms) {
      if (!log) return;
      var seq = ++followSeq, from = log.scrollTop, t0 = performance.now();  // seq cancels any in-flight follow
      (function step(now) {
        if (!followBottom || seq !== followSeq) return;
        var k = Math.min(1, (now - t0) / ms), target = log.scrollHeight - log.clientHeight;
        var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        var y = from + (target - from) * e;
        if (y > log.scrollTop) { log.scrollTop = y; lastScrollTop = log.scrollTop; }
        if (k < 1) requestAnimationFrame(step);
      })(t0);
      setTimeout(function () {   // rAF is throttled in background tabs; guarantee the landing
        if (!followBottom || seq !== followSeq) return;
        log.scrollTop = log.scrollHeight - log.clientHeight;
        lastScrollTop = log.scrollTop;
      }, ms + 90);
    }
    function botMsg(html) {
      var d = document.createElement("div");
      d.className = "msg bot"; d.innerHTML = html;
      log.appendChild(d); followReveal(revealMs(d));
      return d;
    }
    function userMsg(t) {
      var d = document.createElement("div");
      d.className = "msg user"; d.textContent = t;
      log.appendChild(d);
      followBottom = true; log.scrollTop = log.scrollHeight; lastScrollTop = log.scrollTop;
    }

    /* -- the LLM upgrade: one short paragraph per section, via the proxy that holds
          the key. Same question over the same data gives the same paragraphs, so a
          repeat costs no request at all. -- */
    var llmOff = false;
    function llmPayload(sg, tp, shape) {
      var slim = function (n) {
        var o = { name: n.id, type: kindLabel[n.kind] };
        if (n.sub) o.role = n.sub;
        if (n.year) o.year = n.year;
        return o;
      };
      return {
        anchors: sg.anchors.map(function (n) { return n.id; }),
        narrative_shape: shape,
        asked_for: tp ? tp[1] : null,
        counts: { agents: sg.agent.length, projects: sg.project.length, outputs: sg.output.length },
        agents: sg.agent.slice(0, 25).map(slim),
        projects: sg.project.slice(0, 15).map(slim),
        outputs: sg.output.slice(0, 20).map(slim),
        links: sg.chains.slice(0, 40).map(function (c) { return { agent: c.agent.id, relation: c.rel, item: c.via.id }; }),
        themes: Object.keys(sg.themes).sort(function (a, b) { return sg.themes[b] - sg.themes[a]; }).slice(0, 3),
      };
    }
    // **Name** -> clickable graph link when the name is a real node, plain bold when it isn't
    function mdToHtml(s) {
      var out = "", last = 0, re = /\*\*([^*]+)\*\*/g, m;
      s = String(s).replace(/\s+/g, " ").trim();
      while ((m = re.exec(s))) {
        out += esc(s.slice(last, m.index));
        var t = byId[m[1].trim()];
        out += t ? entLink(t) : "<b>" + esc(m[1]) + "</b>";
        last = re.lastIndex;
      }
      return out + esc(s.slice(last));
    }
    function stripTags(html) {
      var d = document.createElement("div"); d.innerHTML = html;
      return d.textContent.replace(/\s+/g, " ").trim();
    }
    function hashStr(s) {
      var h = 2166136261;
      for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return (h >>> 0).toString(36) + s.length;
    }
    function cacheGet(k) { try { var v = sessionStorage.getItem("kgllm:" + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
    function cacheSet(k, v) { try { sessionStorage.setItem("kgllm:" + k, JSON.stringify(v)); } catch (e) { /* full or blocked */ } }
    function applyGloss(el, head, narr, sections, context) {
      var paras = {}, known = {};
      narr.secs.forEach(function (x) { known[x.t] = 1; });
      sections.forEach(function (sec) {   // ignore headings we didn't ask for
        if (sec && known[sec.heading] && sec.paragraph) paras[sec.heading] = mdToHtml(sec.paragraph);
      });
      if (!Object.keys(paras).length) return;
      if (onEntityHover) onEntityHover(null, false);   // links are about to be replaced under the pointer
      /* The context is the one block not drawn from the workbook, so it is kept
         visibly apart and never passed through bindEnts: an entity link here would
         make general background look like a claim about a CBEDS entry. Escaped,
         not mdToHtml'd - it is plain prose by construction. */
      var ctx = context ? '<p class="ai-context">' + esc(context) + '</p>' : '';
      el.innerHTML = head + ctx + renderNarrative(narr, paras) +
        '<div class="ai-note">' +
        (ctx ? 'Background written by AI from general knowledge; section notes' : 'Section notes') +
        ' written by AI from the data shown</div>';
      bindEnts(el);
      followReveal(revealMs(el));
    }
    /* A question that matches nothing never reaches the function, so until now there
       was no record anywhere of what people ask for and do not get - leaving the only
       evidence of a gap in the resolver the chance that someone mentions it. Sends the
       question text and nothing else, and does not care whether it arrives. */
    function reportMiss(q) {
      if (llmOff || !global.fetch || location.protocol === "file:") return;
      try {
        global.fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ miss: String(q).slice(0, 300) }),
          keepalive: true,
        }).catch(noop);
      } catch (e) { /* recording a miss must never break the answer */ }
    }

    function askLLM(q, sg, tp, el, head, narr) {
      if (llmOff || !global.fetch || location.protocol === "file:") return;  // offline / local file
      var body = {
        question: q,
        subgraph: llmPayload(sg, tp, narr.shape),
        sections: narr.secs.map(function (x) { return { heading: x.t, facts: stripTags(x.h).slice(0, 500) }; }),
      };
      var payload = JSON.stringify(body), key = hashStr(payload), hit = cacheGet(key);
      // older cache entries are a bare array of sections, with no context alongside
      if (hit) {
        applyGloss(el, head, narr, hit.sections || hit, hit.context || "");
        return;                                               // asked before — no request needed
      }
      el.classList.add("writing");
      fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload })
        .then(function (r) {
          if (r.status === 404 || r.status === 403) llmOff = true;   // no proxy deployed — stop trying
          if (!r.ok) throw new Error(r.status);
          return r.json();
        })
        .then(function (d) {
          if (!d || !Array.isArray(d.sections) || !d.sections.length) return;
          cacheSet(key, { sections: d.sections, context: d.context || "" });
          applyGloss(el, head, narr, d.sections, d.context || "");
        })
        .catch(function () { /* keep the template answer already on screen */ })
        .then(function () { el.classList.remove("writing"); });
    }

    /* -- the ask itself -- */
    function respond(q) {
      var s = q.toLowerCase();
      var topics = resolveTopics(s);
      var tp = typePred(s), sg = null, centerNode = null, note = "";
      if (topics.length) {
        var sets = topics.map(function (t) {
          var st = {};
          (adj[t.id] || []).forEach(function (e) { st[e.id] = 1; });
          return st;
        });
        sg = subgraphFromNodes(NODES.filter(function (n) { return sets.every(function (st) { return st[n.id]; }); }), topics);
        centerNode = topics[0];
        if (topics.length > 1) note = "Showing what <b>" + topics.map(function (t) { return esc(t.id); }).join("</b> and <b>") + "</b> have in common.";
      } else {
        var topic = resolveTopic(s);
        if (topic && topic.theme) {
          sg = subgraphFromNodes(NODES.filter(function (n) { return (n.themes || []).indexOf(topic.theme) >= 0; }), []);
          note = "Reading that as the <b>" + esc(topic.theme.replace(" and ", " & ")) + "</b> theme.";
        } else if (topic && topic.id) {
          sg = subgraphFromNodes((adj[topic.id] || []).map(function (e) { return byId[e.id]; }).filter(Boolean), [topic]);
          centerNode = topic;
        } else {
          sg = subgraphFromNodes(searchText(s), []);
        }
      }
      if (!(sg.agent.length + sg.project.length + sg.output.length + sg.tech.length)) {
        onNoMatch();
        reportMiss(q);
        var near = nearestTopics(s);
        botMsg(near.length
          ? "No matches for that. Did you mean " + near.map(esc).join(", ") + "?"
          : "No matches for that. Try an acronym (DPP, BIM, DT), a theme, or part of a name.");
        return;
      }
      var shape = pickShape(sg, tp, s);              // the question decides which story gets told
      onAnswer({ sg: sg, centerNode: centerNode, shape: shape });
      // the template answer renders straight away; the LLM prose folds in after, so the
      // panel is never blank and never breaks when the proxy isn't there
      var narr = buildNarrative(sg, tp, shape);
      var head = note ? '<p class="nnote">' + note + "</p>" : "";
      var el = botMsg(head + renderNarrative(narr));
      bindEnts(el);
      askLLM(q, sg, tp, el, head, narr);
    }

    function send() {
      var q = input.value.trim();
      if (!q) return;
      userMsg(q); input.value = "";
      if (sendBtn) sendBtn.disabled = true;
      respond(q);
    }
    function clearAll() {
      log.innerHTML = "";
      followBottom = true; lastScrollTop = 0;
      if (onEntityHover) onEntityHover(null, false);
      onClear();
      input.value = "";
      if (sendBtn) sendBtn.disabled = true;
      botMsg(GREETING);
    }

    if (sendBtn) sendBtn.onclick = send;
    if (input) {
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });
      if (sendBtn) input.addEventListener("input", function () { sendBtn.disabled = !input.value.trim(); });
    }
    if (clearBtn) clearBtn.onclick = clearAll;
    if (opts.greetOnInit !== false) botMsg(GREETING);

    return { ask: respond, send: send, clear: clearAll, index: X, botMsg: botMsg, bindEnts: bindEnts };
  }

  global.CBEDSAssistant = { buildIndex: buildIndex, create: create, esc: esc };
})(window);
