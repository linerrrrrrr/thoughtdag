// Codex as an agent runtime: one long-lived `codex app-server` (JSON-RPC 2.0
// over stdio, newline-delimited). A run is one turn on one thread: fresh
// (`thread/start` in the working directory), continued (`thread/resume`),
// or branched (`thread/fork`). The server's notifications become the same
// shared runtime events plus structured activity snapshots: messages,
// reasoning summaries, command output, tools, plans, and lifecycle details.
// Questions are the server's own approval and user-input requests. Codex keeps its rollout
// files, login and model list; the shell only asks.
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const { snapshotDir, diffSnapshots } = require('./fs-diff.cjs');
const { validateHistory, readRollout, captureNativeTurn } = require('./codex-history.cjs');

const fsp = fs.promises;
const RESPONSE_MS = 30 * 1000;
const { createCodexLaunchResolver } = require('./codex-launch.cjs');
const EXTRA_HOMES = [path.join(os.homedir(), '.codex', 'bin')];
const CANVAS_VISUAL_INSTRUCTIONS = [
  'This canvas can show interactive previews inside an answer. When the user requests an inline interactive preview, use the visualize skill if available.',
  'Otherwise save a self-contained HTML fragment with local interaction to a new .html file in a writable task output folder under the current workspace.',
  'Place \uE200visualize\uE202{"path":"<absolute path to that file>"}\uE201 on its own line in the final answer. Use a distinct filename for each revision.',
].join(' ');

/** The codex binary and the directories walked to find it (see where.cjs). */
const findCodex = createCodexLaunchResolver({ extraHomes: EXTRA_HOMES });

/** The canvas approval mode expressed as a Codex policy:
 *  ask → the workspace sandbox, escalations asked of the person; auto → the
 *  same, with escalations decided by Codex's own reviewer (anything it turns
 *  down still comes to the person); allow → no sandbox, nothing asked. */
async function policyFor(req, cwd) {
  let mode = req.codexWorkspace?.permissionMode;
  if (mode === 'native' || (!req.codexWorkspace && req.nativePermissions === true)) return {};
  if (!req.codexWorkspace) {
    // Older clients persist their chosen policy in the run directory.
    try { mode = JSON.parse(await fsp.readFile(path.join(cwd, '.thoughtdag', 'guard.json'), 'utf8'))?.mode; } catch { /* default to ask */ }
  }
  if (mode === 'allow') return { approvalPolicy: 'never', sandbox: 'danger-full-access', approvalsReviewer: 'user' };
  return { approvalPolicy: 'on-request', sandbox: 'workspace-write', approvalsReviewer: mode === 'auto' ? 'auto_review' : 'user' };
}

// the thread id is in the rollout's file name; take the LAST UUID in the
// path in case a directory carries one of its own
const threadIdOf = (sessionPath) => {
  const all = String(sessionPath ?? '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
  return all && all.length ? all[all.length - 1] : null;
};

const ACTIVITY_LIMIT = 100000;
const activityText = (value) => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
const itemStatus = (item, completed) => {
  if (['failed', 'declined', 'rejected', 'error'].includes(item.status) || item.error || item.success === false || (typeof item.exitCode === 'number' && item.exitCode !== 0)) return 'failed';
  if (['interrupted', 'cancelled', 'canceled', 'incomplete'].includes(item.status)) return 'interrupted';
  return completed ? 'completed' : 'running';
};

/** Project the public app-server lifecycle into ordered, replaceable UI items.
 *  Complete items are authoritative; deltas never append a second copy of them.
 *  Only readable reasoning summaries are displayed, never encrypted/raw blocks. */
function createCodexEventProjector(run) {
  const items = new Map();
  const messages = new Map();
  const summaries = new Map();
  const pendingOutput = new Map();
  let outputTimer = null;
  let serial = 0;
  const put = (id, patch) => {
    const prior = items.get(id);
    // A completion may replace the buffered output with an authoritative copy.
    const next = { id, kind: 'unknown', status: 'running', startedAt: Date.now(), ...prior, ...pendingOutput.get(id), ...patch };
    pendingOutput.delete(id);
    for (const key of ['text', 'output', 'command']) {
      if (typeof next[key] === 'string' && next[key].length > ACTIVITY_LIMIT) {
        next[key] = key === 'output' ? next[key].slice(-ACTIVITY_LIMIT) : next[key].slice(0, ACTIVITY_LIMIT);
        next.truncated = true;
      }
    }
    if (patch.details !== undefined) {
      const json = JSON.stringify(next.details, (key, value) => /^(encrypted_content|encryptedContent|content|result)$/.test(key) && typeof value === 'string' && value.length > ACTIVITY_LIMIT ? `[${value.length} characters omitted]` : /^(encrypted_content|encryptedContent)$/.test(key) ? undefined : value);
      if (json && json.length > ACTIVITY_LIMIT) { next.details = json.slice(0, ACTIVITY_LIMIT); next.truncated = true; }
      else if (json) next.details = JSON.parse(json);
    }
    if (next.status !== 'running' && !next.endedAt) next.endedAt = Date.now();
    items.set(id, next);
    run.emit({ type: 'activity', item: next });
    return next;
  };
  const flushOutput = () => {
    outputTimer = null;
    for (const id of pendingOutput.keys()) put(id, {});
  };
  const appendOutput = (id, delta, sourceType) => {
    const prior = items.get(id);
    if (!prior?.output) {
      return put(id, { kind: sourceType === 'commandExecution' ? 'command' : 'file', sourceType, output: delta });
    }
    // The renderer consumes snapshots. Joining and sending the whole log on
    // every small stdout fragment can produce megabytes of IPC per frame.
    const pending = pendingOutput.get(id);
    const output = (pending?.output ?? prior.output) + delta;
    // Trim in blocks so retaining the tail doesn't copy 100k for every byte.
    pendingOutput.set(id, {
      output: output.length > 2 * ACTIVITY_LIMIT ? output.slice(-ACTIVITY_LIMIT) : output,
      ...(pending?.truncated || output.length > ACTIVITY_LIMIT ? { truncated: true } : {}),
    });
    if (outputTimer === null) outputTimer = setTimeout(flushOutput, 100);
  };
  const syncText = (id) => {
    const text = [...messages.values()].filter((m) => m.phase !== 'commentary').map((m) => m.text).filter(Boolean).join('\n\n');
    if (text === run.text) return;
    const previous = run.text;
    run.text = text;
    run.final = text;
    const phase = messages.get(id)?.phase;
    run.emit({ type: 'message_update', itemId: id, phase, assistantMessageEvent: text.startsWith(previous)
      ? { type: 'text_delta', delta: text.slice(previous.length) }
      : { type: 'text_replace', text } });
  };
  const message = (id, patch, completed = false) => {
    const next = { text: '', ...messages.get(id), ...patch };
    messages.set(id, next);
    put(id, { kind: next.phase === 'commentary' ? 'commentary' : 'message', sourceType: 'agentMessage', phase: next.phase, text: next.text, status: completed ? 'completed' : 'running', ...(patch.startedAt ? { startedAt: patch.startedAt } : {}), ...(patch.endedAt ? { endedAt: patch.endedAt } : {}) });
    syncText(id);
  };
  const lifecycle = (it, completed, params = {}) => {
    if (!it.id || it.type === 'userMessage') return;
    const time = { ...(typeof (it.startedAtMs ?? params.startedAtMs) === 'number' ? { startedAt: it.startedAtMs ?? params.startedAtMs } : {}), ...(typeof (it.completedAtMs ?? params.completedAtMs) === 'number' ? { endedAt: it.completedAtMs ?? params.completedAtMs } : {}) };
    const common = { sourceType: it.type, status: itemStatus(it, completed), ...time };
    if (it.type === 'agentMessage') return message(it.id, { text: typeof it.text === 'string' ? it.text : messages.get(it.id)?.text ?? '', ...(it.phase !== undefined ? { phase: it.phase } : {}), ...time }, completed);
    if (it.type === 'reasoning') {
      const summary = Array.isArray(it.summary) ? it.summary.map((s) => typeof s === 'string' ? s : s?.text ?? '') : null;
      if (summary && (summary.length || completed)) summaries.set(it.id, summary);
      const shown = put(it.id, { ...common, kind: 'reasoning', text: (summaries.get(it.id) ?? []).join('\n\n') });
      if (completed) summaries.delete(it.id);
      return shown;
    }
    if (it.type === 'commandExecution') return put(it.id, { ...common, kind: 'command', command: it.command, cwd: it.cwd, ...(typeof it.aggregatedOutput === 'string' ? { output: it.aggregatedOutput } : {}), exitCode: it.exitCode ?? null, durationMs: it.durationMs ?? null, details: { commandActions: it.commandActions, processId: it.processId, status: it.status } });
    if (it.type === 'fileChange') return put(it.id, { ...common, kind: 'file', text: (it.changes ?? []).map((c) => c.path).join('\n'), details: { changes: it.changes, status: it.status } });
    if (it.type === 'plan') return put(it.id, { ...common, kind: 'plan', text: it.text ?? '' });
    if (it.type === 'mcpToolCall' || it.type === 'dynamicToolCall') return put(it.id, { ...common, kind: 'tool', title: it.server ? `${it.server}/${it.tool}` : it.tool, ...(it.result != null || it.error != null || it.contentItems != null ? { output: activityText(it.result ?? it.error ?? it.contentItems) } : {}), durationMs: it.durationMs ?? null, details: { arguments: it.arguments, status: it.status, error: it.error, appContext: it.appContext, mcpAppUi: it.mcpAppUi } });
    if (['webSearch', 'imageView', 'imageGeneration', 'collabAgentToolCall', 'collabToolCall', 'subAgentActivity', 'functionCallOutput', 'sleep'].includes(it.type)) return put(it.id, { ...common, kind: 'tool', title: it.tool ?? it.name ?? it.type, text: it.query ?? it.path ?? it.prompt ?? it.agentPath ?? it.savedPath, ...(it.output != null ? { output: activityText(it.output) } : {}), details: it });
    if (['contextCompaction', 'enteredReviewMode', 'exitedReviewMode', 'hookPrompt'].includes(it.type)) return put(it.id, { ...common, kind: 'status', text: it.review, details: it });
    return put(it.id, { ...common, kind: 'unknown', title: it.type, details: it });
  };
  const finish = (how) => {
    clearTimeout(outputTimer);
    for (const item of items.values()) if (item.status === 'running') put(item.id, { status: item.sourceType === 'turn' && how === 'end' ? 'completed' : how === 'error' || how === 'exit' || how === 'idle' ? 'failed' : 'interrupted' });
    flushOutput();
  };
  function notification(method, params = {}, emittedAtMs) {
    const id = String(params.itemId ?? '');
    const old = items.get(id);
    switch (method) {
      case 'item/started': return lifecycle(params.item ?? {}, false, params);
      case 'item/completed': return lifecycle(params.item ?? {}, true, params);
      case 'item/agentMessage/delta': return message(id, { text: (messages.get(id)?.text ?? '') + String(params.delta ?? '') });
      case 'item/reasoning/summaryPartAdded': {
        const parts = summaries.get(id) ?? [];
        parts[params.summaryIndex ?? parts.length] ??= '';
        summaries.set(id, parts);
        return put(id, { kind: 'reasoning', sourceType: 'reasoning', text: parts.join('\n\n') });
      }
      case 'item/reasoning/summaryTextDelta': {
        const parts = summaries.get(id) ?? [];
        const index = params.summaryIndex ?? 0;
        const delta = String(params.delta ?? '');
        const length = parts.reduce((total, part) => total + part.length, 0);
        parts[index] = (parts[index] ?? '') + delta.slice(0, Math.max(0, ACTIVITY_LIMIT - length));
        summaries.set(id, parts);
        return put(id, { kind: 'reasoning', sourceType: 'reasoning', text: parts.join('\n\n'), ...(length + delta.length > ACTIVITY_LIMIT ? { truncated: true } : {}) });
      }
      case 'item/reasoning/textDelta':
        // Raw reasoning is not a user-facing summary and must not be mixed in.
        if (!old) return put(id, { kind: 'reasoning', sourceType: 'reasoning', text: '' });
        return;
      case 'item/commandExecution/outputDelta': return appendOutput(id, String(params.delta ?? ''), 'commandExecution');
      case 'item/fileChange/outputDelta': return appendOutput(id, String(params.delta ?? ''), 'fileChange');
      case 'item/commandExecution/terminalInteraction': return put(id, { kind: 'command', sourceType: 'commandExecution', details: { ...(old?.details && typeof old.details === 'object' ? old.details : {}), terminalInteraction: params } });
      case 'item/fileChange/patchUpdated': return put(id, { kind: 'file', sourceType: 'fileChange', text: (params.changes ?? []).map((c) => c.path).join('\n'), details: { changes: params.changes } });
      case 'item/mcpToolCall/progress': return put(id, { kind: 'tool', sourceType: 'mcpToolCall', text: String(params.message ?? '') });
      case 'item/plan/delta': return put(id, { kind: 'plan', sourceType: 'plan', text: (old?.text ?? '') + String(params.delta ?? '') });
      case 'turn/started':
        run.turnId = params.turn?.id ?? run.turnId;
        return put(`turn:${run.turnId ?? 'active'}`, { kind: 'status', sourceType: 'turn', status: 'running', details: { status: params.turn?.status } });
      case 'turn/completed':
        for (const item of params.turn?.items ?? []) lifecycle(item, true);
        put(`turn:${params.turn?.id ?? run.turnId ?? 'active'}`, { kind: 'status', sourceType: 'turn', status: itemStatus(params.turn ?? {}, true), details: { status: params.turn?.status, error: params.turn?.error } });
        return finish(params.turn?.status === 'failed' ? 'error' : params.turn?.status === 'interrupted' ? 'aborted' : 'end');
      case 'turn/plan/updated': return put(`plan:${params.turnId ?? run.turnId}`, { kind: 'plan', sourceType: method, status: 'completed', text: params.explanation ?? '', details: { plan: params.plan ?? [] } });
      case 'turn/diff/updated': return put(`diff:${params.turnId ?? run.turnId}`, { kind: 'file', sourceType: method, status: 'completed', output: params.diff ?? '' });
      case 'thread/tokenUsage/updated': return put(`usage:${params.turnId ?? run.turnId}`, { kind: 'status', sourceType: method, status: 'completed', details: params.tokenUsage });
      case 'thread/status/changed': return put(`thread:${params.threadId}`, { kind: 'status', sourceType: method, status: 'completed', details: params.status });
      case 'mcpServer/startupStatus/updated': return put(`mcp:${params.name}`, { kind: 'status', sourceType: method, title: params.name, status: params.status === 'starting' ? 'running' : params.status === 'failed' ? 'failed' : params.status === 'cancelled' ? 'interrupted' : 'completed', text: params.error ?? '', details: params });
      case 'error': return put(`error:${++serial}`, { kind: 'status', sourceType: method, status: params.willRetry ? 'completed' : 'failed', text: params.error?.message ?? params.message ?? '', details: params });
      case 'warning':
      case 'guardianWarning':
      case 'configWarning': return put(`warning:${++serial}`, { kind: 'status', sourceType: method, status: 'completed', text: params.message ?? params.summary ?? '', details: params });
      case 'item/autoApprovalReview/started':
      case 'item/autoApprovalReview/completed': return put(`review:${params.reviewId}`, { kind: 'status', sourceType: 'autoApprovalReview', status: method.endsWith('/started') ? 'running' : 'completed', details: params });
      case 'hook/started':
      case 'hook/completed': return put(`hook:${params.run?.id ?? params.run?.hookId ?? ++serial}`, { kind: 'status', sourceType: 'hook', status: method.endsWith('/started') ? 'running' : itemStatus(params.run ?? {}, true), details: params.run });
      default:
        return put(`event:${++serial}`, { kind: 'unknown', sourceType: method, title: method, status: 'completed', details: params, ...(typeof emittedAtMs === 'number' ? { startedAt: emittedAtMs } : {}) });
    }
  }
  const userInput = (text) => put(`steer:${randomUUID()}`, { kind: 'user', sourceType: 'userMessage', phase: 'user', text, status: 'completed' });
  return { notification, finish, userInput };
}

function createCodexRuntime({ log } = {}) {
  const say = log || (() => {});
  let proc = null;            // the app-server child
  let ready = null;           // initialize handshake
  let launching = null;       // concurrent first runs share one launch/handshake
  let buf = '';
  let nextId = 1;
  const pending = new Map();  // our request id → resolve
  const runs = new Map();     // runId → run state
  const byThread = new Map(); // threadId → runId
  const threadReservations = new Map(); // hold a continuation from validation through completion
  const serverAsks = new Map(); // question id → { rpcId, respond(answer) }

  const write = (obj) => { try { proc.stdin.write(JSON.stringify(obj) + '\n'); return true; } catch { return false; } };
  const send = (method, params, timeoutMs = RESPONSE_MS) => new Promise((resolve, reject) => {
    if (!proc) return reject(new Error('codex app-server is not running'));
    lastUse = Date.now();
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`codex did not answer ${method} in ${timeoutMs / 1000}s`)); }, timeoutMs);
    pending.set(id, (msg) => { clearTimeout(timer); if (msg.error) reject(new Error(msg.error.message || `codex refused ${method}`)); else resolve(msg.result); });
    if (!write({ jsonrpc: '2.0', id, method, params })) { clearTimeout(timer); pending.delete(id); reject(new Error('codex stdin closed')); }
  });

  // The app-server retires after SERVER_IDLE_MS without a run or a request:
  // a catalog read at picker time must not pin a hundred megabytes for the
  // rest of the launch. The next run starts it again.
  const SERVER_IDLE_MS = Number(process.env.TD_AGENT_IDLE_MS) || 10 * 60 * 1000;
  let lastUse = Date.now();
  const retire = setInterval(() => {
    if (!proc || runs.size || pending.size || Date.now() - lastUse < SERVER_IDLE_MS) return;
    say('codex app-server idle; stopping it');
    try { proc.kill(); } catch { /* gone */ }
    proc = null; ready = null;
  }, 30 * 1000);
  retire.unref?.();

  const die = (reason) => {
    for (const p of pending.values()) p({ error: { message: reason } });
    pending.clear();
    for (const r of runs.values()) { r.end('exit'); r.emit({ type: 'run_error', message: reason }); }
    proc = null; ready = null;
  };

  async function ensureServer(lookup) {
    if (proc && ready) return ready;
    if (!launching) launching = launchServer(lookup).finally(() => { launching = null; });
    return launching;
  }

  async function launchServer(lookup) {
    const found = lookup ?? await findCodex();
    const b = found.path;
    if (!b) throw new Error(found.error || 'The local agent executable was not found on PATH or in the usual installation directories.');
    proc = spawn(found.command, found.args, { env: found.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    buf = '';
    const decoder = new StringDecoder('utf8');
    proc.stdout.on('data', (d) => {
      buf += decoder.write(d);
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        dispatch(msg);
      }
    });
    proc.stderr.on('data', (d) => say('[codex stderr] ' + d.toString().trim().slice(0, 400)));
    proc.on('error', (e) => die('spawn error: ' + e.message));
    proc.on('exit', (code, signal) => die(`codex exited (${signal || code})`));
    ready = send('initialize', { clientInfo: { name: 'thoughtdag', title: 'ThoughtDAG', version: '0.5.0' }, capabilities: null })
      .then(() => { write({ jsonrpc: '2.0', method: 'initialized', params: {} }); });
    return ready;
  }

  // the effort a turn ran at, as the rollout records it (turn_context.effort):
  // the model's own default when the canvas named none
  async function turnEffortOf(file) {
    if (!file) return null;
    try {
      const lines = (await fsp.readFile(file, 'utf8')).split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"turn_context"')) continue;
        try { const o = JSON.parse(lines[i]); if (o.type === 'turn_context' && typeof o.payload?.effort === 'string') return o.payload.effort; } catch { /* torn line */ }
      }
    } catch { /* no file yet */ }
    return null;
  }

  // ~/.codex/config.toml `model_reasoning_effort` overrides every model's own
  // default; the picker's 'default' must name what a turn will actually use
  async function configuredEffort() {
    try {
      const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
      const m = (await fsp.readFile(path.join(home, 'config.toml'), 'utf8')).match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m);
      return m ? m[1] : null;
    } catch { return null; }
  }

  const runOf = (threadId) => { const id = byThread.get(threadId); return id ? runs.get(id) : undefined; };

  // ── the server speaks: responses, notifications, and its own requests ──
  function dispatch(msg) {
    lastUse = Date.now();
    if (msg.id !== undefined && msg.method === undefined) { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); p(msg); } return; }
    const params = msg.params ?? {};
    const run = runOf(params.threadId);
    if (msg.id !== undefined && msg.method) { serverRequest(msg, run); return; }
    if (!run) {
      if (['warning', 'guardianWarning', 'configWarning', 'deprecationNotice'].includes(msg.method)) {
        for (const active of runs.values()) active.projector.notification(msg.method, params, msg.emittedAtMs);
      }
      return;
    }
    // Raw protocol events must never enter the display adapter (or leak reasoning).
    if (msg.method === 'rawResponseItem/completed') return;
    run.projector.notification(msg.method, params, msg.emittedAtMs);
    switch (msg.method) {
      case 'item/started': {
        const it = params.item ?? {};
        const t = toolOf(it);
        if (t) run.emit({ type: 'tool_execution_start', toolCallId: it.id, toolName: t.name, args: t.args });
        break;
      }
      case 'item/completed': {
        const it = params.item ?? {};
        const t = toolOf(it);
        if (t) run.emit({ type: 'tool_execution_end', toolCallId: it.id, toolName: t.name, result: t.result, isError: t.isError });
        break;
      }
      case 'turn/completed': {
        const turn = params.turn ?? {};
        if (turn.status === 'failed') run.emit({ type: 'run_error', message: turn.error?.message ?? 'the turn failed' });
        run.end(turn.status === 'interrupted' ? 'aborted' : turn.status === 'failed' ? 'error' : 'end');
        break;
      }
      case 'serverRequest/resolved': {
        const id = `q-${params.requestId}`;
        const ask = serverAsks.get(id);
        if (ask?.runId === run.runId) {
          serverAsks.delete(id);
          run.waiting = [...serverAsks.values()].some((q) => q.runId === run.runId);
          run.emit({ type: 'question_answered', id, outcome: 'cancelled', value: null });
        }
        break;
      }
      default: break;
    }
  }

  /** A thread item as a tool call, for the trace and the record. */
  function toolOf(it) {
    switch (it.type) {
      case 'commandExecution': return { name: 'bash', args: { command: it.command, cwd: it.cwd }, result: it.aggregatedOutput ?? null, isError: it.status === 'failed' || (typeof it.exitCode === 'number' && it.exitCode !== 0) };
      case 'fileChange': return { name: 'edit', args: { path: (it.changes ?? []).map((c) => c.path).join(', ') }, result: it.status ?? null, isError: it.status === 'failed' || it.status === 'declined' };
      case 'mcpToolCall': return { name: `${it.server}/${it.tool}`, args: it.arguments ?? {}, result: it.result ?? it.error ?? null, isError: !!it.error };
      case 'dynamicToolCall': return { name: it.tool, args: it.arguments ?? {}, result: null, isError: it.status === 'failed' };
      case 'webSearch': return { name: 'web_search', args: { query: it.query ?? '' }, result: null, isError: false };
      default: return null;
    }
  }

  // ── the server asks the person: approvals and user input ──
  function serverRequest(msg, run) {
    const reply = (result) => write({ jsonrpc: '2.0', id: msg.id, result });
    const params = msg.params ?? {};
    if (!run) {
      // nobody at the canvas for this thread: fail closed
      if (msg.method === 'item/tool/requestUserInput') return reply({ answers: {} });
      if (msg.method === 'item/permissions/requestApproval') return reply({ permissions: {}, scope: 'turn' });
      return reply({ decision: 'decline' });
    }
    const ask = (question, respond) => {
      const id = `q-${msg.id}`;
      serverAsks.set(id, { rpcId: msg.id, runId: run.runId, respond });
      run.waiting = true;
      run.emit({ type: 'question', id, ...question });
    };
    const decided = (id, outcome, value, extra) => { run.waiting = [...serverAsks.values()].some((q) => q.runId === run.runId); run.emit({ type: 'question_answered', id, outcome, value: value ?? null, ...(extra ?? {}) }); };
    // a yes/no the conversation may have settled already: `rule` names what a
    // standing allowance covers; a match is accepted for the session without asking
    const settle = (rule, title, message, respondYes) => {
      if (rule && run.allowRules?.has(rule)) { respondYes(true); run.emit({ type: 'question_answered', id: `auto-${msg.id}`, outcome: 'allowed-session', value: null, auto: true, title, message, rule }); return true; }
      return false;
    };
    const yesNo = (rule, respondYes, respondNo) => (a, id) => {
      const yes = !!a?.confirmed; const forSession = yes && a?.scope === 'session' && !!rule;
      if (forSession) run.allowRules?.add(rule);
      if (yes) respondYes(forSession); else respondNo();
      decided(id, yes ? (forSession ? 'allowed-session' : 'allowed-once') : 'rejected', null, forSession ? { rule } : undefined);
    };
    switch (msg.method) {
      case 'item/commandExecution/requestApproval': {
        const cmd = Array.isArray(params.command) ? params.command.join(' ') : String(params.command ?? '');
        const rule = cmd ? 'codex:cmd:' + cmd : null;
        const title = 'command needs approval'; const message = cmd;
        const respondYes = (forSession) => reply({ decision: forSession ? 'acceptForSession' : 'accept' });
        if (settle(rule, title, [message, params.reason].filter(Boolean).join('\n'), respondYes)) return;
        return ask({ kind: 'confirm', title, message, reason: params.reason ?? null, rule, options: [], placeholder: null, prefill: null, paths: [], suggest: null },
          yesNo(rule, respondYes, () => reply({ decision: 'decline' })));
      }
      case 'item/fileChange/requestApproval': {
        const rule = 'codex:fileChange';
        const title = 'file change needs approval'; const message = params.grantRoot || '';
        const respondYes = (forSession) => reply({ decision: forSession ? 'acceptForSession' : 'accept' });
        if (settle(rule, title, [params.reason, message].filter(Boolean).join('\n') || 'apply the proposed file changes', respondYes)) return;
        return ask({ kind: 'confirm', title, message, reason: params.reason ?? null, rule, options: [], placeholder: null, prefill: null, paths: [], suggest: null },
          yesNo(rule, respondYes, () => reply({ decision: 'decline' })));
      }
      case 'item/permissions/requestApproval':
        return ask({ kind: 'confirm', title: 'more permissions requested', message: JSON.stringify(params.permissions ?? {}), reason: params.reason ?? null, options: [], placeholder: null, prefill: null, paths: [], suggest: null },
          (a, id) => { const yes = !!a?.confirmed; reply({ permissions: yes ? (params.permissions ?? {}) : {}, scope: 'turn' }); decided(id, yes ? 'allowed-once' : 'rejected'); });
      case 'item/tool/requestUserInput': {
        // the questions as one form; the answers go back together, keyed by
        // question id (a secret answer stays out of the record)
        const qs = (Array.isArray(params.questions) ? params.questions : []).filter((q) => q && typeof q.id === 'string');
        return ask({
          kind: 'form', title: 'request_user_input', message: qs.map((q) => q.question || q.header || '').join('\n'),
          questions: qs.map((q) => ({
            id: q.id, question: q.question || '', ...(q.header ? { header: q.header } : {}),
            options: (Array.isArray(q.options) ? q.options : []).filter((o) => o && typeof o.label === 'string').map((o) => ({ label: o.label, ...(o.description ? { description: o.description } : {}) })),
            custom: !!q.isOther || !(Array.isArray(q.options) && q.options.length), secret: !!q.isSecret,
          })),
          options: [], placeholder: null, prefill: null, paths: [], suggest: null,
        }, (a, id) => {
          const given = Array.isArray(a?.answers) ? a.answers : [];
          const answers = {};
          for (const q of qs) {
            const g = given.find((x) => x && x.id === q.id);
            const own = typeof g?.custom === 'string' && g.custom.trim() ? [g.custom.trim()] : [];
            answers[q.id] = { answers: [...(Array.isArray(g?.selected) ? g.selected.filter((x) => typeof x === 'string') : []), ...own] };
          }
          reply({ answers });
          const shown = qs.filter((q) => !q.isSecret && answers[q.id].answers.length).map((q) => `${q.header || q.question} → ${answers[q.id].answers.join(', ')}`).join('; ');
          decided(id, given.length ? 'answered' : 'cancelled', shown || null);
        });
      }
      default:
        return write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unsupported request ${msg.method}` } });
    }
  }

  const effortsIn = (m) => (m.supportedReasoningEfforts ?? []).map((e) => (e && typeof e === 'object' ? e.reasoningEffort : e)).filter((e) => typeof e === 'string');
  const modelEntry = (m) => ({
    provider: 'codex', id: m.model ?? m.id, name: m.displayName ?? m.model ?? m.id, reasoning: true, vision: true,
    efforts: effortsIn(m), defaultEffort: typeof m.defaultReasoningEffort === 'string' ? m.defaultReasoningEffort : null,
    supportsFast: m.serviceTiers?.some(tier => tier.id === 'priority') === true || m.additionalSpeedTiers?.includes('fast') === true,
    defaultFast: m.defaultServiceTier === 'priority',
  });
  // Only pass settings advertised by this installed runtime for the selected model.
  const modelsById = new Map();
  const noteModels = (r) => {
    modelsById.clear();
    for (const model of r?.data ?? []) modelsById.set(model.model ?? model.id, modelEntry(model));
  };
  // the model a run uses when the canvas named none: the server's own
  // default from model/list, not the config file's — a config can name a
  // model this CLI version cannot run, and the list only carries runnable ones
  let defaultModel = null;
  async function defaultModelId() {
    if (defaultModel) return defaultModel;
    try { const r = await send('model/list', {}); noteModels(r); const d = (r?.data ?? []).find((m) => m.isDefault) ?? (r?.data ?? [])[0]; defaultModel = d ? (d.model ?? d.id) : null; } catch { /* leave it to the config */ }
    return defaultModel;
  }

  return {
    available: async () => (await findCodex()).path,

    async models() {
      const found = await findCodex();
      if (!found.path) return { installed: false, models: [], default: null, searched: found.searched, failures: found.failures, ...(found.error ? { error: found.error } : {}) };
      await ensureServer(found);
      const r = await send('model/list', {});
      noteModels(r);
      const configured = await configuredEffort();
      const models = (r?.data ?? []).filter((m) => !m.hidden).map(modelEntry).map((m) => (configured && m.efforts.includes(configured) ? { ...m, defaultEffort: configured } : m));
      const def = (r?.data ?? []).find((m) => m.isDefault);
      defaultModel = def ? (def.model ?? def.id) : defaultModel;
      return { installed: true, models, default: def ? `codex/${def.model ?? def.id}` : (models[0] ? `codex/${models[0].id}` : null) };
    },

    async run(req, onEvent) {
      const cwd = String(req.cwd || '');
      if (!cwd || !path.isAbsolute(cwd)) throw new Error('run needs an absolute cwd');
      const nativeInput = validateHistory(req.codexHistory);
      await fsp.mkdir(cwd, { recursive: true });
      await ensureServer();
      const runId = randomUUID();
      const emit = (event) => { try { onEvent({ runId, event }); } catch { /* renderer gone */ } };
      const state = { runId, threadId: null, turnId: null, text: '', final: null, waiting: false, emit, end: null, done: null,
        reservedThreads: new Set(), userTexts: [String(req.prompt ?? '')],
        // what this conversation already allowed for good (see README: `rule`)
        allowRules: new Set(Array.isArray(req.allowRules) ? req.allowRules.filter((s) => typeof s === 'string' && s.startsWith('codex:')) : []) };
      state.projector = createCodexEventProjector(state);
      state.done = new Promise((resolve) => { state.end = (how) => { if (state.ended) return; state.ended = true; state.projector.finish(how); resolve(how); }; });
      runs.set(runId, state);
      void (async () => {
        const IDLE = Number(process.env.TD_AGENT_IDLE_MS) || 10 * 60 * 1000;
        let lastEvent = Date.now();
        const origEmit = state.emit;
        state.emit = (event) => { lastEvent = Date.now(); origEmit(event); };
        const watchdog = setInterval(() => {
          if (state.waiting || Date.now() - lastEvent < IDLE) return;
          state.emit({ type: 'run_error', message: `no activity for ${IDLE >= 60000 ? Math.round(IDLE / 60000) + ' min' : Math.round(IDLE / 1000) + ' s'}; the turn was stopped` });
          if (state.threadId && state.turnId) send('turn/interrupt', { threadId: state.threadId, turnId: state.turnId }).catch(() => {});
          setTimeout(() => state.end('idle'), 5000);
        }, 15000);
        try {
          const policy = await policyFor(req, cwd);
          const model = (req.model && typeof req.model === 'object' && req.model.id ? req.model.id : null) ?? await defaultModelId();
          if (model && (req.codexWorkspace || req.effort !== undefined || typeof req.fast === 'boolean') && !modelsById.has(model)) {
            await send('model/list', {}).then(noteModels).catch(() => {});
          }
          let thread;
          let continued = false;
          let fresh = false;
          let injectedCount = 0;
          const instructions = typeof req.instructions === 'string' ? req.instructions : '';
          const settings = { cwd, ...policy, ...(model ? { model } : {}),
            ...(req.codexWorkspace ? { developerInstructions: [instructions, CANVAS_VISUAL_INSTRUCTIONS].filter(Boolean).join('\n\n') }
              : typeof req.instructions === 'string' ? { developerInstructions: instructions } : {}) };
          let sandboxPolicy;
          const openThread = async (method, params) => {
            const response = await send(method, params);
            const base = response.sandbox;
            sandboxPolicy = undefined;
            if (req.managedFileDirs?.length && base?.type === 'workspaceWrite') {
              sandboxPolicy = { ...base, writableRoots: [...new Set([...(base.writableRoots ?? []), ...req.managedFileDirs])] };
            }
            return response.thread;
          };
          const reserve = (id) => {
            if (threadReservations.has(id) || byThread.has(id)) return false;
            threadReservations.set(id, runId); state.reservedThreads.add(id); return true;
          };
          const release = (id) => {
            if (threadReservations.get(id) === runId) threadReservations.delete(id);
            state.reservedThreads.delete(id);
          };
          const base = nativeInput?.base;
          if (base && reserve(base.threadId)) {
            try {
              const stored = (await send('thread/read', { threadId: base.threadId })).thread;
              const file = stored?.path;
              const beforeResume = await readRollout(file);
              const idle = !['active', 'systemError'].includes(stored?.status?.type);
              if (idle && beforeResume.sessionId === base.threadId && beforeResume.checkpoint === base.checkpoint && beforeResume.lastTurnId === base.turnId) {
                const resumed = await openThread('thread/resume', { threadId: base.threadId, excludeTurns: true, ...settings });
                const afterResume = await readRollout(resumed.path ?? file);
                if (afterResume.checkpoint === base.checkpoint && afterResume.lastTurnId === base.turnId) {
                  thread = { ...resumed, path: resumed.path ?? file };
                  continued = true;
                  injectedCount = base.itemCount;
                }
              }
            } catch (error) { say(`native continuation unavailable: ${error instanceof Error ? error.message : String(error)}`); }
            if (!thread) release(base.threadId);
          }
          if (!thread && nativeInput) {
            thread = await openThread('thread/start', settings);
            fresh = true;
          } else if (!thread) {
            const resumeId = typeof req.sessionId === 'string' && req.sessionId ? req.sessionId : req.sessionPath ? threadIdOf(req.sessionPath) : null;
            if (resumeId && !reserve(resumeId)) throw new Error('The native thread already has an active run');
            if (req.forkEntryId && resumeId) { thread = await openThread('thread/fork', { threadId: resumeId, lastTurnId: req.forkEntryId, excludeTurns: true, ...settings }); fresh = true; }
            else if (resumeId) { thread = await openThread('thread/resume', { threadId: resumeId, excludeTurns: true, ...settings }); continued = true; }
            else { thread = await openThread('thread/start', settings); fresh = true; }
          }
          if (!thread?.id) throw new Error('The native runtime did not return a thread identity');
          // Session-scoped permissions belong only to the thread actually resumed.
          if (!continued) state.allowRules.clear();
          state.threadId = thread.id;
          byThread.set(thread.id, runId);
          const session = { type: 'session', sessionId: thread.id, sessionFile: thread.path ?? null, model: model ? { provider: 'codex', id: model, name: model } : null, cwd, continued };
          try {
            if (nativeInput && nativeInput.items.length > injectedCount) {
              await send('thread/inject_items', { threadId: thread.id, items: nativeInput.items.slice(injectedCount) });
            }
          } catch (error) {
            // A failed materialization is never used for inference or silently retried.
            if (fresh) await send('thread/archive', { threadId: thread.id }).catch(() => {});
            throw new Error(`Native history injection failed: ${error instanceof Error ? error.message : String(error)}`);
          }
          state.emit(session);
          // External workspace files belong to the user. Only legacy runs
          // capture directory changes as implicit canvas attachments.
          const before = req.codexWorkspace ? null : await snapshotDir(cwd).catch(() => null);
          const input = [{ type: 'text', text: String(req.prompt ?? ''), text_elements: [] }];
          for (const img of Array.isArray(req.images) ? req.images : []) if (img && typeof img.data === 'string') input.push({ type: 'image', url: `data:${img.mimeType};base64,${img.data}` });
          const modelInfo = modelsById.get(model);
          const selectedEffort = modelInfo?.efforts.includes(req.effort) ? req.effort : undefined;
          // Reasoning effort is sticky on the native thread. A new canvas
          // question using the default needs to send it on a resumed thread.
          const useDefaultEffort = !selectedEffort && (req.codexWorkspace || req.effort === '') && modelInfo?.efforts.length;
          const configured = useDefaultEffort ? await configuredEffort() : null;
          const effort = selectedEffort ?? (useDefaultEffort
            ? (modelInfo.efforts.includes(configured) ? configured : modelInfo.defaultEffort)
            : undefined);
          const serviceTierForTurn = modelInfo?.supportsFast && typeof req.fast === 'boolean'
            ? (req.fast ? 'priority' : 'default') : undefined;
          const started = await send('turn/start', {
            threadId: thread.id, input, summary: 'auto',
            ...(sandboxPolicy && { sandboxPolicy }), ...(model ? { model } : {}),
            ...(effort ? { effort } : {}), ...(serviceTierForTurn ? { serviceTierForTurn } : {}),
          }, 60 * 1000);
          state.turnId = started?.turn?.id ?? null;
          state.emit({ ...session, turnId: state.turnId });
          if (state.abortRequested && state.turnId) send('turn/interrupt', { threadId: state.threadId, turnId: state.turnId }).catch(() => {});
          const how = await state.done;
          const ran = await turnEffortOf(thread.path);
          const capture = how === 'end'
            ? await captureNativeTurn(thread.path, { turnId: state.turnId, userTexts: state.userTexts })
            : { capture: 'unavailable', items: [], checkpoint: null, reason: 'The native turn did not complete successfully' };
          state.emit({ ...session, turnId: state.turnId, ...(ran ? { effort: ran } : {}), nativeHistory: {
            version: 1, threadId: thread.id, turnId: state.turnId,
            historyFingerprint: nativeInput?.fingerprint ?? null, mappings: nativeInput?.mappings ?? [], ...capture,
          } });
          if (before) {
            const after = await snapshotDir(cwd).catch(() => null);
            if (after) { const d = diffSnapshots(before, after); if (d.changed.length || d.added.length || d.removed.length || d.truncated) state.emit({ type: 'fs_changes', ...d }); }
          }
          state.emit({ type: 'run_end', text: state.final ?? state.text, how });
        } catch (e) {
          state.projector.finish('error');
          state.emit({ type: 'run_error', message: e instanceof Error ? e.message : String(e) });
          state.emit({ type: 'run_end', text: state.final ?? state.text, how: 'error' });
        } finally {
          clearInterval(watchdog);
          if (state.threadId && byThread.get(state.threadId) === runId) byThread.delete(state.threadId);
          for (const id of state.reservedThreads) if (threadReservations.get(id) === runId) threadReservations.delete(id);
          for (const [id, ask] of serverAsks) if (ask.runId === runId) serverAsks.delete(id);
          runs.delete(runId);
        }
      })();
      return runId;
    },

    async steer(runId, prompt) {
      const text = typeof prompt === 'string' ? prompt : '';
      if (!text.trim()) throw new Error('A steering message cannot be empty');
      const run = runs.get(runId);
      if (!run || run.ended || run.abortRequested || !run.threadId || !run.turnId) throw new Error('The agent turn is no longer accepting messages');
      await send('turn/steer', { threadId: run.threadId, expectedTurnId: run.turnId, input: [{ type: 'text', text, text_elements: [] }] });
      run.userTexts.push(text);
      run.projector.userInput(text);
      return true;
    },

    abort(runId) {
      const r = runs.get(runId);
      if (!r) return false;
      r.abortRequested = true;
      // withdraw any question still open for this run, then interrupt
      for (const [id, ask] of serverAsks) if (ask.runId === runId) { serverAsks.delete(id); ask.respond({ confirmed: false, cancelled: true }, id); }
      if (r.threadId && r.turnId) send('turn/interrupt', { threadId: r.threadId, turnId: r.turnId }).catch(() => {});
      return true;
    },

    answer(runId, requestId, response) {
      const ask = serverAsks.get(String(requestId));
      if (!ask || ask.runId !== runId || !runs.has(runId)) return false;
      serverAsks.delete(String(requestId));
      const a = response && typeof response === 'object' ? response : { confirmed: !!response };
      if (a.cancelled) { ask.respond({ confirmed: false, value: '' }, String(requestId)); return true; }
      ask.respond(a, String(requestId));
      return true;
    },

    shutdown() { clearInterval(retire); try { proc?.kill(); } catch { /* gone */ } proc = null; ready = null; },
  };
}

module.exports = { createCodexRuntime, findCodex, createCodexEventProjector };
