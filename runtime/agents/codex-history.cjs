'use strict';

const fs = require('node:fs');
const readline = require('node:readline');
const { createHash } = require('node:crypto');

const CALLS = new Map([['function_call', 'function_call_output'], ['custom_tool_call', 'custom_tool_call_output']]);
const OUTPUTS = new Set(CALLS.values());
const RUNTIME_TEXT = /^\s*(?:# AGENTS\.md instructions for |<\/?(?:environment_context|permissions instructions|permissions_instructions|skills_instructions|app-context|recommended_plugins|codex_apps_[\w-]+|user_instructions|developer_instructions|system_reminder)(?:\s|>))/i;
const clone = (value) => JSON.parse(JSON.stringify(value));

/** Validate before creating or modifying any thread. Never silently truncate history. */
function validateItems(items) {
  if (!Array.isArray(items)) throw new Error('Native history items must be an array');
  const calls = new Map();
  const completed = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid native history item');
    if (item.encrypted_content !== undefined || item.encryptedContent !== undefined) throw new Error('Opaque reasoning cannot be replayed as native history');
    if (item.type === 'message') {
      if (!['user', 'assistant'].includes(item.role) || !Array.isArray(item.content) || !item.content.length || item.channel === 'analysis') throw new Error('Only user and assistant conversation messages can be replayed');
      for (const part of item.content) {
        if (['input_text', 'output_text', 'text'].includes(part?.type)) {
          if (typeof part.text !== 'string') throw new Error('Native history text must be a string');
        } else if (part?.type === 'input_image') {
          if (typeof part.image_url !== 'string' || !/^(https?:\/\/|data:image\/)/i.test(part.image_url)) throw new Error('Invalid native history image');
        } else throw new Error(`Unsupported native message content: ${part?.type ?? 'unknown'}`);
      }
    } else if (CALLS.has(item.type)) {
      if (typeof item.call_id !== 'string' || !item.call_id || calls.has(item.call_id) || typeof item.name !== 'string' || !item.name) throw new Error('Native tool calls need unique call IDs and names');
      if (typeof (item.type === 'function_call' ? item.arguments : item.input) !== 'string') throw new Error('Native tool call input must remain a string');
      calls.set(item.call_id, CALLS.get(item.type));
    } else if (OUTPUTS.has(item.type)) {
      if (calls.get(item.call_id) !== item.type || completed.has(item.call_id) || item.output === undefined) throw new Error('Native tool output has no unique preceding matching call');
      completed.add(item.call_id);
    } else throw new Error(`Unsupported native history item: ${item.type ?? 'unknown'}`);
  }
  if (calls.size !== completed.size) throw new Error('Native history contains unfinished tool calls');
  return clone(items);
}

function validateHistory(history) {
  if (history == null) return null;
  if (history.version !== 1 || typeof history.fingerprint !== 'string' || !history.fingerprint) throw new Error('Invalid native history version or fingerprint');
  const items = validateItems(history.items);
  if (!Array.isArray(history.mappings)) throw new Error('Native history mappings must be an array');
  for (const mapping of history.mappings) {
    if (!mapping || (mapping.nodeId !== null && typeof mapping.nodeId !== 'string') || !Number.isInteger(mapping.itemStart) || !Number.isInteger(mapping.itemEnd) || mapping.itemStart < 0 || mapping.itemEnd < mapping.itemStart || mapping.itemEnd > items.length) throw new Error('Invalid native history node mapping');
  }
  let base;
  if (history.base != null) {
    const b = history.base;
    if (typeof b.threadId !== 'string' || !b.threadId || typeof b.turnId !== 'string' || !b.turnId || typeof b.checkpoint !== 'string' || !b.checkpoint || !Number.isInteger(b.itemCount) || b.itemCount < 0 || b.itemCount > items.length) throw new Error('Invalid native history continuation checkpoint');
    // A suffix may not begin in the middle of a tool call/result pair.
    validateItems(items.slice(0, b.itemCount));
    validateItems(items.slice(b.itemCount));
    base = clone(b);
  }
  return { version: 1, items, mappings: clone(history.mappings), fingerprint: history.fingerprint, ...(base ? { base } : {}) };
}

/** Read the persisted raw stream, independently of the lossy UI projection. */
async function readRollout(file, { turnId = null, userTexts = [] } = {}) {
  if (!file) throw new Error('The native thread has no readable rollout file');
  const hash = createHash('sha256');
  const items = [];
  const omitted = new Set();
  let sessionId = null;
  let lastTurnId = null;
  let collecting = false;
  let foundTurn = false;
  let completedTurn = false;
  const allowedUsers = new Set(userTexts);
  const input = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { throw new Error('The native rollout contains an incomplete or invalid record'); }
      const p = entry.payload ?? {};
      if (entry.type === 'session_meta') sessionId = p.id ?? sessionId;
      const boundary = entry.type === 'turn_context' || (entry.type === 'event_msg' && p.type === 'task_started');
      const ending = entry.type === 'event_msg' && ['task_complete', 'task_completed', 'turn_aborted'].includes(p.type);
      if (['response_item', 'turn_context', 'compacted'].includes(entry.type) || boundary || ending) hash.update(JSON.stringify({ type: entry.type, payload: p }) + '\n');
      if (boundary && p.turn_id) {
        lastTurnId = p.turn_id;
        collecting = p.turn_id === turnId;
        if (collecting) foundTurn = true;
      }
      if (ending && p.turn_id) {
        lastTurnId = p.turn_id;
        if (p.turn_id === turnId) { completedTurn = p.type !== 'turn_aborted'; collecting = false; }
      }
      if (!collecting || entry.type !== 'response_item') continue;
      if (p.type === 'message') {
        if (!['user', 'assistant'].includes(p.role) || p.channel === 'analysis') { omitted.add(p.role ?? p.type); continue; }
        if (p.role === 'user') {
          const content = (p.content ?? []).filter((part) => {
            if (typeof part.text !== 'string') return part.type === 'input_image';
            return allowedUsers.size ? allowedUsers.has(part.text) : !RUNTIME_TEXT.test(part.text);
          });
          if (!content.some((part) => typeof part.text === 'string' && (!allowedUsers.size || allowedUsers.has(part.text)))) { omitted.add('runtime_user_context'); continue; }
          items.push({ ...p, content });
        } else items.push(p);
      } else if (CALLS.has(p.type) || OUTPUTS.has(p.type)) items.push(p);
      else omitted.add(p.type ?? 'unknown');
    }
  } finally { lines.close(); input.destroy(); }
  return { checkpoint: hash.digest('hex'), sessionId, lastTurnId, foundTurn, completedTurn, items, omittedTypes: [...omitted] };
}

async function captureNativeTurn(file, options) {
  try {
    let read;
    // Completion notifications and the rollout flush can arrive a few moments apart.
    // Retry the read only; never replay the turn or its side effects.
    for (let attempt = 0; attempt < 4; attempt++) {
      try { read = await readRollout(file, options); } catch (error) {
        if (!file || attempt === 3) throw error;
      }
      if (read?.foundTurn && read.completedTurn) break;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)));
    }
    if (!read) throw new Error('The completed turn could not be read from the native rollout');
    if (!read.foundTurn || !read.completedTurn) throw new Error('The completed turn is not yet present in the native rollout');
    const items = validateItems(read.items.map((item) => {
      const portable = { ...item };
      delete portable.id;
      delete portable.metadata;
      return portable;
    }));
    if (!items.some((item) => item.type === 'message' && item.role === 'user') || !items.some((item) => item.type === 'message' && item.role === 'assistant')) throw new Error('The native rollout does not contain the complete user and assistant messages');
    const unknown = read.omittedTypes.filter((type) => !['reasoning', 'system', 'developer', 'runtime_user_context', 'configuration_update'].includes(type));
    if (unknown.length) throw new Error(`Native turn includes unsupported raw items: ${unknown.join(', ')}`);
    return { capture: 'complete', items, checkpoint: read.checkpoint, omittedTypes: read.omittedTypes };
  } catch (error) {
    return { capture: 'unavailable', items: [], checkpoint: null, reason: error instanceof Error ? error.message : String(error) };
  }
}

module.exports = { validateItems, validateHistory, readRollout, captureNativeTurn };
