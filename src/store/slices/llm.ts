import type { StateCreator } from 'zustand';
import type { ThoughtNode, ThoughtEdge } from '../../types';
import { documentCopyText, isEditableDocument } from '../../lib/document-copy';
import { generateId } from '../../utils';
import { placeNewNodes } from '../../lib/layout';
import { getDescendantIds, selectionSinks, walkUpAncestors } from '../../lib/graph';
import { COLORS } from '../../lib/constants';
import type { ContextMessage, ImageAttachment } from '../../lib/api';
import { buildContext, buildIncomingContext, type MessageSource } from '../context-builder';
import { activeAbortControllers, runNodeGeneration, triggerParadigmCascade } from '../streaming';
import { useUiStore, toast, recallSnapshot } from '../../lib/ui-store';
// the stale set a request carries is the one the preview shows: the fingerprint's minus the judge's dismissals (#51)
import { shownStaleIds } from '../../lib/stale-judge';
import { t, fmt } from '../../i18n';
import type { StoreState, LlmSlice, AddQuestionOptions } from '../types';
import { condenseGuard } from '../../lib/condense-guard';
import { isNotebook, notebookContext } from '../../lib/notebook';
import { requestAgentStop } from '../../lib/agents/agent-runtime';
import { inheritedNodeExecution } from '../../lib/node-execution';

export const createLlmSlice: StateCreator<StoreState, [], [], LlmSlice> = (set, get) => ({
  addQuestion: async (question: string, opts: AddQuestionOptions = {}) => {
    if (condenseGuard()) return;
    // the ask is one step, recorded when its answer lands (settleNode); settle what came before it
    get().pushHistory();
    const { parentId, initialAttachments, excludeAllInheritedAttachments, mentions } = opts;
    const id = generateId();
    get().logEvent('ask', id, { chars: question.length, ...(parentId ? {} : { root: true }) });
    // Children preserve their parent's execution type and compatible model.
    // Roots snapshot the global choice; later toolbar changes cannot cross lanes.
    const inheritedExecution = inheritedNodeExecution(parentId ? get().nodes.find((n) => n.id === parentId)?.data : undefined, useUiStore.getState().selectedModel);
    const newNode: ThoughtNode = {
      id,
      type: 'thought',
      position: { x: 0, y: 0 },
      dragHandle: '.drag-handle',
      data: {
        question,
        createdAt: new Date().toISOString(),
        askedAt: new Date().toISOString(),
        ...inheritedExecution,
        response: '',
        responses: [],
        responseIndex: -1,
        isCollapsed: false,
        isEditing: false,
        isEditingResponse: false,
        isLoading: true,
        tokenCount: 0,
        highlights: [], highlightMode: 'tag', attachments: initialAttachments || [],
        excludedAttachmentIds: excludeAllInheritedAttachments && parentId
          ? get().getInheritedAttachments(parentId).map(({ attachment }) => attachment.id).concat(
              (get().nodes.find((n) => n.id === parentId)?.data.attachments || []).map((a) => a.id)
            )
          : [],
        includedAttachmentIds: [],
        // Search permissions are per-ask: snapshot the toggles shown next to
        // the input, so reruns of this node keep behaving the same way
        webSearch: useUiStore.getState().webSearchEnabled,
        scholarSearch: useUiStore.getState().scholarSearchEnabled,
        ...recallSnapshot(),
      },
    };

    const newEdge = parentId ? {
      id: `edge-${parentId}-${id}`,
      source: parentId,
      target: id,
      sourceHandle: 'continue',
      targetHandle: 'top',
      type: 'smoothstep',
      style: { stroke: COLORS.accent, strokeWidth: 2 },
      animated: false,
      markerEnd: { type: 'arrowclosed' as const, color: COLORS.accent, width: 18, height: 18 },
      data: {},
    } : null;

    let newEdges: ThoughtEdge[] = newEdge ? [...get().edges, newEdge] : get().edges;
    // @-mentions: any mentioned node NOT already flowing into this one gets
    // a real dashed reference edge — @ is the keyboard's way of drawing a
    // wire, never an invisible injection. Ones already upstream stay pure
    // designators (their content is in the walk; nothing double-feeds).
    const mentionIds = (mentions ?? []).filter((mid) => mid !== id && mid !== parentId && get().nodes.some((n) => n.id === mid));
    if (mentionIds.length > 0) {
      const structural = newEdges.filter((e) => !e.data?.isCrossLink);
      const upstream = parentId
        ? new Set(walkUpAncestors(parentId, get().nodes, structural).ordered.map((n) => n.id))
        : new Set<string>();
      const refSources = new Set(newEdges.filter((e) => e.data?.isCrossLink && e.target === id).map((e) => e.source));
      let wired = 0;
      for (const mid of mentionIds) {
        if (upstream.has(mid) || refSources.has(mid)) continue;
        newEdges = [...newEdges, {
          id: `crosslink-${mid}-${id}`,
          source: mid, target: id,
          sourceHandle: 'branch', targetHandle: 'left',
          type: 'smoothstep',
          style: { stroke: COLORS.accent, strokeDasharray: '8 4', strokeWidth: 2 },
          animated: true,
          data: { isCrossLink: true, createdAt: new Date().toISOString() },
        }];
        wired++;
      }
      if (wired > 0) toast('info', fmt(t('mention.wired'), { n: wired }), 6000);
    }
    // Auto-collapse parent node when creating a child
    const updatedNodes = parentId
      ? get().nodes.map((n) => n.id === parentId ? { ...n, data: { ...n.data,
          isCollapsed: (n.data.detailLevel ?? useUiStore.getState().canvasDetail) !== 'full',
        } } : n)
      : get().nodes;
    const newNodes = placeNewNodes([...updatedNodes, newNode], newEdges, [id]);
    set({ nodes: newNodes, edges: newEdges, selectedNodeId: id });

    // Compile the new node's incoming edges, including references attached
    // by @-mentions. Compiling only the parent would omit those new wires.
    const selfNode = get().nodes.find((n) => n.id === id);
    const ctx = buildIncomingContext(id, get().nodes, get().edges,
      selfNode?.data.excludedAttachmentIds, selfNode?.data.includedAttachmentIds, shownStaleIds(get()));
    const contextMessages = ctx.messages;
    const contextImages = ctx.images;

    // Collect this node's own attachments (skip if same file already from ancestors)
    const selfAttachments = selfNode?.data.attachments || [];
    for (const att of selfAttachments) {
      const alreadyInContext = contextMessages.some(m => m.content.includes(`[PDF: ${att.name}]`) || m.content.includes(`[File: ${att.name}]`) || m.content.startsWith(`[Notebook: ${att.name} — `));
      if (alreadyInContext) continue;
      if (att.type.startsWith('image/')) {
        contextImages.push({ data: att.content, mimeType: att.type });
      } else if (isEditableDocument(att)) {
        // text channel only — page images trip provider image-count limits
        const body = documentCopyText(att);
        if (body || att.editedText !== undefined) {
          contextMessages.push({ role: 'user', content: `[${att.type === 'application/pdf' ? 'PDF' : 'File'}: ${att.name}]\n${body}` });
        }
      } else if (att.type === 'text/html') {
        // extracted Markdown only — raw HTML source never reaches a model
        if (att.extractedText?.trim()) {
          contextMessages.push({ role: 'user', content: `[File: ${att.name}]\n${att.extractedText}` });
        }
      } else if (isNotebook(att)) {
        // converted cells only — the raw JSON (base64 figures and all) never reaches a model
        if (att.extractedText?.trim()) contextMessages.push({ role: 'user', content: notebookContext(att) });
        if (att.renderMode !== 'text-only') {
          for (const f of att.figures ?? []) contextImages.push({ data: f.data, mimeType: f.mimeType, hasCompanion: true });
        }
      } else if (att.content) {
        contextMessages.push({ role: 'user', content: `[File: ${att.name}]\n${att.content}` });
      }
    }

    contextMessages.push({ role: 'user', content: question });

    await runNodeGeneration(set, get, id, { question, messages: contextMessages, images: contextImages, sources: ctx.sources });
  },

  submitHumanTurn: (nodeId: string, question: string) => {
    if (condenseGuard()) return;
    const q = question.trim();
    if (!q) return;
    get().pushHistory();
    get().logEvent('ask', nodeId, { chars: q.length, human: true });
    // Second run of a paradigm: changing the input makes every answered
    // step downstream stale — the replay chip is the "re-run experiment"
    // button. Surface the blast radius, same as editQuestion.
    const prevQuestion = get().nodes.find((n) => n.id === nodeId)?.data.question;
    if (prevQuestion && prevQuestion !== q) {
      const staleCount = getDescendantIds(nodeId, get().edges)
        .filter((id) => get().nodes.find((n) => n.id === id)?.data.response).length;
      if (staleCount > 0) toast('info', fmt(t('toast.editMakesStale'), { n: staleCount }), 7000);
    }
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, question: q, askedAt: new Date().toISOString(), isEditing: false } } : n
      ),
    }));
    get().pushHistory();
    triggerParadigmCascade(get, nodeId);
  },

  editQuestion: async (nodeId: string, question: string) => {
    if (condenseGuard()) return;
    get().pushHistory();
    get().logEvent('edit-question', nodeId, { chars: question.length });
    // Staleness seed: descendants keep answers written against the OLD
    // content — surface the blast radius now, replay stays manual.
    const prevQuestion = get().nodes.find((n) => n.id === nodeId)?.data.question;
    if (prevQuestion && prevQuestion !== question) {
      const staleCount = getDescendantIds(nodeId, get().edges)
        .filter((id) => get().nodes.find((n) => n.id === id)?.data.response).length;
      if (staleCount > 0) toast('info', fmt(t('toast.editMakesStale'), { n: staleCount }), 7000);
    }
    // A node asked for the first time (an empty card dropped on the canvas)
    // is an ask like any other: the switches shown under its question box
    // are snapshotted now, the recall menu's one-ask choice spent here. A
    // re-worded question keeps the snapshot its node was asked with.
    const firstAsk = !prevQuestion
      ? { webSearch: useUiStore.getState().webSearchEnabled, scholarSearch: useUiStore.getState().scholarSearchEnabled, ...recallSnapshot() }
      : {};
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: {
          ...n.data,
          // Turn versions: the wording is changing — pin the OLD wording to
          // every existing version first (absent array = they all shared it),
          // so the (question, answer) pairs stay truthful after the edit.
          ...(prevQuestion && prevQuestion !== question && n.data.responses.length > 0
            ? { questions: n.data.responses.map((_, i) => n.data.questions?.[i] ?? prevQuestion) }
            : {}),
          ...firstAsk,
          question, askedAt: new Date().toISOString(), isEditing: false, isLoading: true,
        } } : n
      ),
    }));
    // Rebuild context with this node's own Q&A blanked out
    const editNode = get().nodes.find((n) => n.id === nodeId);
    const editCtx = buildContext(nodeId, get().nodes.map(n =>
      n.id === nodeId ? { ...n, data: { ...n.data, question: '', response: '' } } : n
    ), get().edges, editNode?.data.excludedAttachmentIds, editNode?.data.includedAttachmentIds, shownStaleIds(get()));
    const contextMessages = editCtx.messages;
    contextMessages.push({ role: 'user', content: question });

    // Append, never replace: the old (question, answer) pairs stay switchable
    // — an edited question must not orphan or erase the versions written
    // against the old wording.
    await runNodeGeneration(set, get, nodeId, { question, messages: contextMessages, images: editCtx.images, versionMode: 'append', sources: editCtx.sources });
  },

  regenerate: async (nodeId: string) => {
    const node = get().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    get().pushHistory();

    // Find a structural parent (any incoming edge) for creating sibling
    const parentEdge = get().edges.find((e) => e.target === nodeId);
    const parentId = parentEdge?.source;

    // Create a new sibling node with the same question
    const id = generateId();
    get().logEvent('regenerate', nodeId);
    const newNode: ThoughtNode = {
      id,
      type: 'thought',
      position: { x: 0, y: 0 },
      dragHandle: '.drag-handle',
      data: {
        question: node.data.question,
        response: '',
        responses: [],
        responseIndex: -1,
        isCollapsed: false,
        isEditing: false,
        isEditingResponse: false,
        isLoading: true,
        tokenCount: 0,
        highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
        model: node.data.model, // sibling keeps the original's model override
        executionKind: node.data.executionKind,
      },
    };

    const newEdges = parentId
      ? [...get().edges, { id: `edge-${parentId}-${id}`, source: parentId, target: id, type: 'smoothstep' }]
      : get().edges;

    const newNodes = placeNewNodes([...get().nodes, newNode], newEdges, [id]);
    set({ nodes: newNodes, edges: newEdges, selectedNodeId: id });

    const regenSelf = get().nodes.find((n) => n.id === id);
    const regenCtx = parentId
      ? buildContext(parentId, get().nodes, get().edges, regenSelf?.data.excludedAttachmentIds, regenSelf?.data.includedAttachmentIds, shownStaleIds(get()))
      : { messages: [] as ContextMessage[], images: [] as ImageAttachment[], sources: [] as MessageSource[] };
    const contextMessages = regenCtx.messages;
    contextMessages.push({ role: 'user', content: node.data.question });

    await runNodeGeneration(set, get, id, { question: node.data.question, messages: contextMessages, images: regenCtx.images, sources: regenCtx.sources });
  },

  batchMergeSummarize: async (nodeIds: string[], deleteAfter?: boolean, intent?: string) => {
    // One-Rule honest converge: the synthesis node hangs from the selection's
    // SINKS with real edges — ancestors flow in along the chains (transitive
    // reduction), nothing embedded as invisible text.
    const { nodes, edges } = get();
    const selected = nodeIds
      .map((id) => nodes.find((n) => n.id === id))
      .filter((node): node is ThoughtNode => !!node && node.data.stepKind !== 'frame');
    if (selected.length === 0) return;
    const sinkIds = selectionSinks(selected.map((n) => n.id), edges);

    // Create summary node — the user's intent (if any) becomes the visible
    // question, so the card says what this synthesis is FOR
    const id = generateId();
    get().logEvent('merge', id, { n: selected.length, intent: !!intent?.trim() });
    const summaryQuestion = intent?.trim() || `Merge summary of ${selected.length} nodes`;
    const newNode: ThoughtNode = {
      id,
      type: 'thought',
      position: { x: selected[0].position.x, y: selected[0].position.y },
      dragHandle: '.drag-handle',
      data: {
        question: summaryQuestion,
        response: '',
        responses: [''],
        responseIndex: 0,
        isCollapsed: false,
        isEditing: false,
        isEditingResponse: false,
        isLoading: true,
        tokenCount: 0,
        highlights: [],
        highlightMode: 'tag',
        attachments: [],
        excludedAttachmentIds: [], includedAttachmentIds: [],
        webSearch: useUiStore.getState().webSearchEnabled,
        scholarSearch: useUiStore.getState().scholarSearchEnabled,
        ...recallSnapshot(),
      },
    };

    // Fan-in edges from every selected node
    const fanIn: ThoughtEdge[] = sinkIds.map((nid) => ({
      id: `edge-${nid}-${id}`,
      source: nid,
      target: id,
      sourceHandle: 'continue',
      targetHandle: 'top',
      type: 'smoothstep',
      style: { stroke: COLORS.accent, strokeWidth: 2 },
      markerEnd: { type: 'arrowclosed' as const, color: COLORS.accent, width: 18, height: 18 },
      data: {},
    }));

    get().pushHistory();
    const newEdges = [...edges, ...fanIn];
    const newNodes = placeNewNodes([...nodes, newNode], newEdges, [id]);
    set({ nodes: newNodes, edges: newEdges, selectedNodeId: id, selectedNodeIds: [] });

    // Context arrives via the fan-in edges; the prompt is instruction only
    const ctx = buildContext(
      id,
      get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, question: '', response: '' } } : n)),
      get().edges,
      undefined, undefined, shownStaleIds(get()),
    );
    const messages: ContextMessage[] = [
      { role: 'system', content: `You merge conversation nodes. CRITICAL: Your output language MUST match the primary language of the user content. If the content is in Chinese, respond in Chinese. If English, respond in English. Never use German or any other language unless the content is in that language. Do not translate — use the same language as the source.` },
      ...ctx.messages,
      { role: 'user', content: `将以上讨论综合为一份完整文档。(Synthesize the discussion above into one comprehensive document.)

规则 / Rules:
1. 输出语言必须与上面内容的主要语言一致。(Output language must match the primary language of the content above.)
2. 这是综合(synthesis)，不是流水摘要：提炼出经过这些讨论后「我们现在知道什么」。(This is a SYNTHESIS, not a running summary: distill what we NOW KNOW after these discussions.)
3. 按此结构组织 / Structure:
   - **结论 (Conclusions)** — 立得住的要点，合并重复表述 (consolidated takeaways, dedup repeated points)
   - **依据 (Key evidence)** — 支撑结论的关键论据/数据/引用 (the arguments, data or citations that carry the conclusions)
   - **分歧与未决 (Open questions)** — 节点间的矛盾之处与尚未回答的问题 (contradictions between nodes and what remains unanswered)
4. 保留所有独特洞见与引用标注，丢弃寒暄和重复。(Keep every unique insight and citation marker; drop filler and repetition.)
5. 只输出综合后的内容，不要元评论。(Output ONLY the synthesis.)${intent?.trim() ? `

用户对这次综合的额外要求（优先满足，可覆盖上面的结构）/ The user's specific request for this synthesis (takes priority, may override the structure above):
${intent.trim()}` : ''}` },
    ];

    await runNodeGeneration(set, get, id, {
      question: summaryQuestion,
      messages,
      images: ctx.images,
      // the fan-in parents ARE the members, plus whatever the compiler drew
      sources: [...selected.map((n) => ({ layer: 'chain' as const, nodeId: n.id, part: 'response' as const })), ...ctx.sources],
      onSuccess: () => {
        // Optionally delete the merged originals (and their descendants),
        // rewiring the synthesis to the boundary parents so it keeps its
        // ancestry instead of becoming an orphan root
        if (deleteAfter) {
          const allRemove = new Set<string>();
          for (const { id: nid } of selected) {
            allRemove.add(nid);
            for (const d of getDescendantIds(nid, get().edges)) {
              allRemove.add(d);
            }
          }
          // Don't delete the newly created merge node
          allRemove.delete(id);
          const boundaryParents = [...new Set(
            get().edges
              .filter((e) => allRemove.has(e.target) && !allRemove.has(e.source) && e.source !== id && !e.data?.isCrossLink)
              .map((e) => e.source)
          )];
          const rewired: ThoughtEdge[] = boundaryParents.map((pid) => ({
            id: `edge-${pid}-${id}`,
            source: pid,
            target: id,
            sourceHandle: 'continue',
            targetHandle: 'top',
            type: 'smoothstep',
            style: { stroke: COLORS.accent, strokeWidth: 2 },
            markerEnd: { type: 'arrowclosed' as const, color: COLORS.accent, width: 18, height: 18 },
            data: {},
          }));
          set((state) => ({
            nodes: state.nodes.filter((n) => !allRemove.has(n.id)),
            edges: [
              ...state.edges.filter((e) => !allRemove.has(e.source) && !allRemove.has(e.target)),
              ...rewired,
            ],
          }));
        }
      },
    });
  },

  weaveHighlights: async (nodeIds: string[], intent?: string, highlightIds?: string[]) => {
    // The other converge action. Merge compresses RAW content; weave works
    // on the user's OWN marks — highlights are already human-curated, so
    // the model's job is editorial (thread the judged pieces together), the
    // context stays small even canvas-wide, and every sentence can cite [n]
    // back to a specific mark. Human decides first, machine writes second.
    const { nodes, edges } = get();
    const selected = nodeIds
      .map((id) => nodes.find((n) => n.id === id))
      .filter((node): node is ThoughtNode => !!node && node.data.stepKind !== 'frame');
    // Stable numbering: canvas order (nodes array), then mark order per node
    const wanted = highlightIds ? new Set(highlightIds) : null;
    const entries: { n: number; text: string; from: string }[] = [];
    for (const node of nodes) {
      if (!selected.some((s) => s.id === node.id)) continue;
      const title = node.data.question.replace(/\s+/g, ' ').trim().slice(0, 60);
      for (const h of node.data.highlights || []) {
        if (wanted && !wanted.has(h.id)) continue;
        entries.push({ n: entries.length + 1, text: h.text, from: title });
      }
    }
    if (entries.length === 0) return;
    const sinkIds = selectionSinks(selected.map((n) => n.id), edges);

    const id = generateId();
    get().logEvent('weave', id, { marks: entries.length, n: selected.length, intent: !!intent?.trim() });
    const weaveQuestion = intent?.trim() || fmt(t('weave.defaultQuestion'), { n: entries.length });
    const newNode: ThoughtNode = {
      id,
      type: 'thought',
      position: { x: selected[0].position.x, y: selected[0].position.y },
      dragHandle: '.drag-handle',
      data: {
        question: weaveQuestion,
        response: '', responses: [''], responseIndex: 0,
        isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: true,
        tokenCount: 0, highlights: [], highlightMode: 'tag',
        attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
        webSearch: false, scholarSearch: false, // editorial task: no search
      },
    };
    const fanIn: ThoughtEdge[] = sinkIds.map((nid) => ({
      id: `edge-${nid}-${id}`,
      source: nid,
      target: id,
      sourceHandle: 'continue',
      targetHandle: 'top',
      type: 'smoothstep',
      style: { stroke: COLORS.accent, strokeWidth: 2 },
      markerEnd: { type: 'arrowclosed' as const, color: COLORS.accent, width: 18, height: 18 },
      data: {},
    }));

    get().pushHistory();
    const newEdges = [...edges, ...fanIn];
    set({ nodes: placeNewNodes([...nodes, newNode], newEdges, [id]), edges: newEdges, selectedNodeId: id, selectedNodeIds: [] });

    // First generation feeds ONLY the marks (the whole point: human-curated
    // input). The fan-in edges carry provenance and the full upstream for
    // any follow-up question asked on this node later.
    const list = entries.map((e) => `${fmt(t('weave.entry'), { n: String(e.n), from: e.from })}\n${e.text}`).join('\n\n');
    const messages: ContextMessage[] = [
      { role: 'system', content: 'You weave a user\'s own highlighted passages into one coherent text. CRITICAL: Your output language MUST match the primary language of the highlights. Do not translate.' },
      { role: 'user', content: `以下是我在一次探索中亲手标记的 ${entries.length} 条高光，按画布顺序编号，每条注明出处节点。(Below are the ${entries.length} passages I highlighted myself during an exploration, numbered in canvas order, each with its source node.)

${list}` },
      { role: 'user', content: `把这些高光串联成一段连贯的文字。(Weave these highlights into one coherent passage.)

规则 / Rules:
1. 输出语言与高光的主要语言一致。(Match the highlights' primary language.)
2. 这些是我自己判断过的重点：忠实串联与衔接，不要引入高光之外的新论断。(These are MY judged marks: thread and connect them faithfully; introduce no claims beyond the highlights.)
3. 每个来自高光的表述标注 [n] 引用其编号，方便我回溯。(Cite [n] for every statement drawn from a highlight.)
4. 高光之间的矛盾要点明，不要抹平。(Name contradictions between highlights; do not smooth them over.)
5. 只输出串联后的文字。(Output only the woven passage.)${intent?.trim() ? `

用户对这次串联的额外要求（优先满足）/ The user's specific request (takes priority):
${intent.trim()}` : ''}` },
    ];

    await runNodeGeneration(set, get, id, { question: weaveQuestion, messages, sources: nodeIds.map((nid) => ({ layer: 'chain' as const, nodeId: nid, part: 'response' as const })) });
  },

  stopGeneration: (nodeId: string) => {
    if (requestAgentStop(nodeId)) return;
    const controller = activeAbortControllers.get(nodeId);
    if (controller) {
      controller.abort();
      activeAbortControllers.delete(nodeId);
    }
  },
});
