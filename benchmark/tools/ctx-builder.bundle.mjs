// src/lib/graph.ts
function walkUpAncestors(startIds, nodes, edges) {
  const starts = Array.isArray(startIds) ? startIds : [startIds];
  const ordered = [];
  const visited = /* @__PURE__ */ new Set();
  const visitedEdgeIds = /* @__PURE__ */ new Set();
  function walkUp(id) {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    const incoming = edges.filter((e) => e.target === id);
    if (incoming.length > 1) {
      incoming.sort((a, b) => (a.data?.contextOrder ?? Number.MAX_SAFE_INTEGER) - (b.data?.contextOrder ?? Number.MAX_SAFE_INTEGER));
    }
    for (const edge of incoming) {
      visitedEdgeIds.add(edge.id);
      walkUp(edge.source);
    }
    ordered.push(node);
  }
  for (const id of starts) walkUp(id);
  return { ordered, visitedEdgeIds };
}
var CONTENT_KINDS = /* @__PURE__ */ new Set(["note", "file", "link"]);
function partitionContext(nodeId, nodes, edges) {
  const structural = edges.filter((e) => !e.data?.isCrossLink);
  const crossLinks = edges.filter((e) => e.data?.isCrossLink);
  const { ordered: structuralOrdered } = walkUpAncestors(nodeId, nodes, structural);
  const materials = [];
  const mainline = [];
  for (const n of structuralOrdered) {
    (CONTENT_KINDS.has(n.data.stepKind ?? "") ? materials : mainline).push(n);
  }
  const mainlineIds = new Set(structuralOrdered.map((n) => n.id));
  const references = [];
  const seenRefSources = /* @__PURE__ */ new Set();
  for (const edge of crossLinks) {
    if (!mainlineIds.has(edge.target)) continue;
    if (mainlineIds.has(edge.source)) continue;
    if (seenRefSources.has(edge.source)) continue;
    const source = nodes.find((n) => n.id === edge.source);
    if (!source) continue;
    seenRefSources.add(edge.source);
    if (CONTENT_KINDS.has(source.data.stepKind ?? "")) {
      materials.push(source);
      continue;
    }
    references.push({ source, edge });
  }
  return { materials, references, mainline };
}

// src/lib/attachment-fingerprint.ts
function attachmentFingerprint(att) {
  return `${att.name}|${att.size}|${att.content?.substring(0, 100)}`;
}

// src/lib/notebook.ts
var NOTEBOOK_TYPE = "application/x-ipynb+json";
var isNotebook = (att) => att.type === NOTEBOOK_TYPE;
var RECORD = "the outputs below were saved when the author last ran each cell in their own kernel. They are a record, kept for reference; this conversation cannot run code. If the question needs something run, say what to run and why; do not state results you have not seen in the context.";
var notebookContext = (att) => `[Notebook: ${att.name} \u2014 ${RECORD}]
${att.extractedText ?? ""}`;

// src/utils.ts
function countTokens(text) {
  let cjk = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 11904 && c <= 40959 || c >= 63744 && c <= 64255 || c >= 65280 && c <= 65519 || c >= 12288 && c <= 12351) cjk++;
  }
  return Math.ceil(cjk + (text.length - cjk) / 4);
}

// src/lib/highlight-match.ts
var MD_NOISE = "[*_`~()#>\\[\\]|-]*";
var WS_GAP = `\\s+(?:(?:\\d{1,3}[.)]|[-*+>|]|#{1,6}|[-:|]{3,}|[\`~]{3,}[^\\s\`~]*)\\s+)*`;
function fuzzyHighlightRegex(text) {
  const chars = [...text.trim()];
  if (chars.length === 0) return null;
  const parts = [];
  let pendingWs = false;
  for (const ch of chars) {
    if (/\s/.test(ch)) {
      pendingWs = true;
      continue;
    }
    const escaped = ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (parts.length === 0) parts.push(escaped);
    else if (pendingWs) parts.push(`${MD_NOISE}${WS_GAP}${MD_NOISE}${escaped}`);
    else parts.push(`${MD_NOISE}${escaped}`);
    pendingWs = false;
  }
  try {
    return new RegExp(MD_NOISE + parts.join("") + MD_NOISE, "g");
  } catch {
    return null;
  }
}

// src/store/context-builder.ts
function nodeTitle(node) {
  const q = node.data.question.replace(/\s+/g, " ").trim();
  return q.length > 60 ? `${q.slice(0, 60)}\u2026` : q;
}
function renderResponse(node) {
  const mode = node.data.highlightMode || "off";
  const highlights = node.data.highlights || [];
  if (mode === "filter" && highlights.length > 0) {
    return highlights.map((h) => h.text).join("\n\n");
  }
  if (mode === "tag" && highlights.length > 0) {
    let tagged = node.data.response;
    for (const h of highlights) {
      const re = fuzzyHighlightRegex(h.text);
      if (re) tagged = tagged.replace(re, (m) => `[Important] ${m} [/Important]`);
    }
    return tagged;
  }
  return node.data.response;
}
function transcriptLines(node) {
  const lines = [];
  if (node.data.question) lines.push(`Q: ${node.data.question}`);
  const a = renderResponse(node);
  if (a) lines.push(`A: ${a}`);
  return lines;
}
function referenceBlockContent(ref) {
  const lines = [`[Reference: ${nodeTitle(ref.source)}]`];
  lines.push(...transcriptLines(ref.source));
  return lines.join("\n");
}
var RECORD_HEADER = "[Execution record \u2014 an earlier agent turn already ran these tools in its own session. This is a log of what happened there, kept for reference; this conversation has no tools. If the question needs something run or checked, say what to run and why; do not write tool calls, and do not state results you have not seen in the context.]";
var isToolRecord = (att) => att.name.startsWith("tool: ") && att.content.startsWith("[call]");
function recordArgs(call) {
  let parsed;
  try {
    parsed = JSON.parse(call);
  } catch {
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return call.trim();
  const j = parsed;
  const main = j.command ?? j.cmd ?? (Array.isArray(j.queries) ? j.queries.join(" | ") : void 0) ?? j.query ?? j.path ?? j.file_path ?? j.url ?? j.pattern;
  const args = typeof main === "string" ? main : Object.entries(j).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ");
  return args.trim();
}
var indent = (s, n) => s.split("\n").map((l) => " ".repeat(n) + l).join("\n");
function recordItem(att) {
  const body = att.content.slice("[call]".length).replace(/^ /, "");
  const cut = body.indexOf("\n[result]\n");
  const call = cut >= 0 ? body.slice(0, cut) : body;
  const result = (cut >= 0 ? body.slice(cut + "\n[result]\n".length) : "").trimEnd() || "(no output)";
  const args = recordArgs(call);
  const head = `- ${att.name.slice("tool: ".length)}:`;
  return `${args.includes("\n") ? `${head}
${indent(args, 4)}` : `${head} ${args}`}
  result:
${indent(result, 4)}`;
}
function hashContext(messages, images = []) {
  const s = JSON.stringify(messages) + `#img:${images.map((i) => i.data.length).join(",")}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i) | 0;
  return (h >>> 0).toString(36);
}
var STALE_MARK = "[Stale: this answer was written against an earlier version of its upstream]";
function resolveRoleFromMainline(mainline, nodes, opts) {
  const self = mainline[mainline.length - 1];
  if (!self) return void 0;
  if (!opts?.ignoreOwn && self.data.roleSourceNodeId) {
    if (self.data.roleSourceNodeId === "__none__") return void 0;
    const src = nodes.find((n) => n.id === self.data.roleSourceNodeId);
    return src?.data.rolePrompt || void 0;
  }
  for (let i = mainline.length - 1; i >= 0; i--) {
    const n = mainline[i];
    const isSelf = i === mainline.length - 1;
    const own = isSelf && opts?.ignoreOwn ? void 0 : n.data.rolePrompt;
    const mode = n.data.roleMode || "inherit";
    if (mode === "reset") {
      return isSelf ? own || void 0 : void 0;
    }
    if (mode === "set-next" && n.data.rolePrompt) {
      if (isSelf) continue;
      return n.data.rolePrompt;
    }
    if (mode === "inherit" && own) return own;
  }
  return void 0;
}
function buildContext(nodeId, nodes, edges, excludedAttachmentIds, includedAttachmentIds, staleIds) {
  return compileContext(nodeId, nodes, edges, "record", excludedAttachmentIds, includedAttachmentIds, staleIds);
}
function compileContext(nodeId, nodes, edges, toolSteps, excludedAttachmentIds, includedAttachmentIds, staleIds) {
  const messages = [];
  const images = [];
  const sources = [];
  const imageSources = [];
  const layerTokens = { material: 0, reference: 0, chain: 0 };
  let layerStart = 0;
  const closeLayer = (layer) => {
    for (let i = layerStart; i < messages.length; i++) layerTokens[layer] += countTokens(messages[i].content);
    layerStart = messages.length;
  };
  const staleSet = staleIds instanceof Set ? staleIds : new Set(staleIds ?? []);
  const { materials, references, mainline } = partitionContext(nodeId, nodes, edges);
  const excludeSet = new Set(excludedAttachmentIds || []);
  const includeOverrides = new Set(includedAttachmentIds || []);
  for (const node of [...materials, ...mainline]) {
    for (const exId of node.data.excludedAttachmentIds || []) {
      if (!includeOverrides.has(exId)) excludeSet.add(exId);
    }
  }
  const seenAttachmentFingerprints = /* @__PURE__ */ new Set();
  const pushAttachments = (node, layer) => {
    const attSource = (att) => ({ layer, nodeId: node.id, attachmentId: att.id, part: "attachment" });
    const pointers = /* @__PURE__ */ new Map();
    let pointerSource = null;
    const records = [];
    for (const att of node.data.attachments || []) {
      if (excludeSet.has(att.id)) {
        if (att.op && att.paths?.length) {
          pointerSource ??= att;
          const set = pointers.get(att.op) ?? /* @__PURE__ */ new Set();
          for (const p of att.paths) set.add(p.split("/").filter(Boolean).pop() ?? p);
          pointers.set(att.op, set);
        }
        continue;
      }
      const fp = attachmentFingerprint(att);
      if (seenAttachmentFingerprints.has(fp)) continue;
      seenAttachmentFingerprints.add(fp);
      if (att.type.startsWith("image/")) {
        if (att.extractedText) {
          messages.push({ role: "user", content: `[Image: ${att.name}]
${att.extractedText}` });
          sources.push(attSource(att));
        }
        if (att.renderMode !== "text-only") {
          images.push({ data: att.content, mimeType: att.type, ...att.extractedText?.trim() ? { hasCompanion: true } : {} });
          imageSources.push({ nodeId: node.id, attachmentId: att.id });
        }
      } else if (att.type === "application/pdf") {
        if (att.extractedText) {
          messages.push({ role: "user", content: `[PDF: ${att.name}]
${att.extractedText}` });
        } else {
          messages.push({ role: "user", content: `[PDF: ${att.name} \u2014 no extracted text yet (scanned or still extracting). The reader's Recognize can turn its pages into readable text.]` });
        }
        sources.push(attSource(att));
      } else if (att.type === "text/html") {
        const body = att.extractedText?.trim();
        messages.push({
          role: "user",
          content: body ? `[File: ${att.name}]
${body}` : `[File: ${att.name} \u2014 HTML with no extractable text yet]`
        });
        sources.push(attSource(att));
      } else if (isNotebook(att)) {
        messages.push({ role: "user", content: notebookContext(att) });
        sources.push(attSource(att));
        if (att.renderMode !== "text-only") {
          for (const f of att.figures ?? []) {
            images.push({ data: f.data, mimeType: f.mimeType, hasCompanion: true });
            imageSources.push({ nodeId: node.id, attachmentId: att.id });
          }
        }
      } else if (toolSteps === "record" && isToolRecord(att)) {
        records.push(att);
      } else {
        messages.push({ role: "user", content: `[File: ${att.name}]
${att.content}` });
        sources.push(attSource(att));
      }
    }
    if (records.length > 0) {
      messages.push({ role: "user", content: `${RECORD_HEADER}
${records.map(recordItem).join("\n")}` });
      sources.push({ ...attSource(records[0]), attachmentIds: records.map((a) => a.id) });
    }
    if (pointers.size > 0 && pointerSource) {
      const parts = [...pointers.entries()].map(([op, set]) => `${op}: ${[...set].join(", ")}`);
      const where = node.data.agentSession?.cwd ?? node.data.importSource?.cwd;
      messages.push({ role: "user", content: `[Files this turn touched${where ? ` in ${where}` : ""} \u2014 contents not included] ${parts.join("; ")}` });
      sources.push(attSource(pointerSource));
    }
  };
  for (const node of materials) {
    if (node.data.archived) continue;
    pushAttachments(node, "material");
    if (node.data.question) {
      const content = node.data.stepKind === "note" ? `[Note]
${node.data.question}` : node.data.stepKind === "link" ? `[Link snapshot: ${node.data.linkUrl ?? ""} @ ${(node.data.linkFetchedAt ?? "").slice(0, 10)}]
${node.data.question}` : node.data.question;
      messages.push({ role: "user", content });
      sources.push({ layer: "material", nodeId: node.id, part: "question" });
    }
  }
  closeLayer("material");
  for (const ref of references) {
    if (ref.source.data.archived) continue;
    messages.push({ role: "user", content: referenceBlockContent(ref) });
    sources.push({ layer: "reference", refSourceId: ref.source.id, part: "reference" });
  }
  closeLayer("reference");
  for (const node of mainline) {
    if (node.data.archived) continue;
    pushAttachments(node, "chain");
    if (node.data.question) {
      messages.push({ role: "user", content: node.data.question });
      sources.push({ layer: "chain", nodeId: node.id, part: "question" });
    }
    if (node.data.response) {
      const rendered = renderResponse(node);
      messages.push({ role: "assistant", content: staleSet.has(node.id) ? `${STALE_MARK}
${rendered}` : rendered });
      sources.push({ layer: "chain", nodeId: node.id, part: "response" });
    }
  }
  closeLayer("chain");
  const resolvedRole = resolveRoleFromMainline(mainline, nodes);
  if (resolvedRole) {
    messages.unshift({ role: "system", content: resolvedRole });
    sources.unshift({ layer: "system", part: "role" });
  }
  return { messages, images, layerTokens, sources, imageSources };
}
export {
  buildContext,
  countTokens,
  hashContext
};
