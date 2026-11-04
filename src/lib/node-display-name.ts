import type { ThoughtData } from '../types';
import { levelText } from './ladder-core';

const clean = (text: string): string => text
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/gm, '')
  .replace(/\*\*|__|`/g, '')
  .replace(/\s+/g, ' ').trim();

const firstLine = (text: string | undefined): string => text?.split(/\r?\n/).find((line) => line.trim() && !/^[#*_=`>\s-]+$/.test(line))?.trim() ?? '';

/** Full, unabridged label source for tooltips and renaming; never an answer summary. */
export function getNodeNameSource(data: Partial<ThoughtData>, fallback: string): string {
  const explicit = clean(data.displayName ?? '');
  if (explicit) return explicit;

  const version = data.responseIndex ?? 0;
  const topic = clean(data.summaryTopics?.[version] ?? '');
  if (topic) return topic;
  const ladder = data.summaryLadders?.[version];
  // Local ladders may call an answer's opening fragment its topic; only a selected topic names a node.
  if (ladder?.model && ladder.model !== 'local' && ladder.topic?.length && Array.isArray(ladder.tokens)) {
    const topic = clean(levelText(ladder, 0));
    if (topic) return topic;
  }

  let source = '';
  if (data.stepKind === 'file') source = data.attachments?.[0]?.name?.split(/[\\/]/).pop() ?? '';
  else if (data.stepKind === 'link') source = data.linkTitle?.startsWith('⚠') ? data.linkUrl ?? '' : data.linkTitle || data.linkUrl || '';
  else if (data.stepKind === 'note') source = data.question?.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1] ?? firstLine(data.question);
  return [source, firstLine(data.question), fallback].map(clean).find(Boolean) ?? '';
}

/** A conservative local excerpt: keep source wording, remove polite lead-ins, never invent a title. */
export function getNodeDisplayName(data: Partial<ThoughtData>, fallback: string): string {
  const source = getNodeNameSource(data, fallback);
  let name = source;
  if (!data.displayName?.trim() && !['file', 'link', 'note'].includes(data.stepKind ?? '') && source === clean(firstLine(data.question))) {
    name = name
      .replace(/^(?:请(?:你(?:帮我)?|帮我|问)|麻烦(?:你(?:帮我)?|帮我)|帮我)[，,、\s]*/, '')
      .replace(/^(?:(?:please\s+)?(?:can|could|would)\s+you\s+|please\s+|help me\s+)/i, '')
      .trim() || source;
  }

  const cjk = /[\u3040-\u30ff\u3400-\u9fff]/.test(name);
  const limit = cjk ? 14 : 48;
  const extension = data.stepKind === 'file' ? name.match(/\.[a-z\d]{1,8}$/i)?.[0] ?? '' : '';
  const body = extension ? name.slice(0, -extension.length) : name;
  const words = body.split(/\s+/);
  const excerpt = !cjk && words.length > 6 ? words.slice(0, 6).join(' ') : body;
  const characters = [...excerpt];
  const clipped = characters.length + extension.length > limit || excerpt !== body;
  if (!clipped) return name;
  const budget = Math.max(1, limit - extension.length - 1);
  let short = characters.slice(0, budget).join('');
  if (!cjk && characters.length > budget && /\s/.test(short)) short = short.replace(/\s+\S*$/, '');
  return `${short.replace(/[\s,，、:：;；-]+$/, '')}…${extension}`;
}
