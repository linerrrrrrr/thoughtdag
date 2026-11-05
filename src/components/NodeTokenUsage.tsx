import { memo, useMemo } from 'react';
import { Wrench } from 'lucide-react';
import { fmt, useT } from '../i18n';
import { isToolStep, thinkingTokens, toolFingerprint } from '../lib/turn-insight';
import type { ThoughtData } from '../types';
import { countTokens } from '../utils';
import type { TooltipDetails } from './ui/GlobalTooltip';
import './NodeTokenUsage.css';

const numberFormat = new Intl.NumberFormat('en-US');
const percentFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

function shareOf(value: number, total: number): string {
  if (total === 0) return '—';
  const percent = value / total * 100;
  return percent > 0 && percent < 0.1 ? '<0.1%' : `${percentFormat.format(percent)}%`;
}

export default memo(function NodeTokenUsage({ data }: { data: ThoughtData }) {
  const t = useT();
  const { question, response, attachments, excludedAttachmentIds, reasonings, reasoningTokens, responseIndex } = data;
  const toolTitle = useMemo(() => toolFingerprint({ attachments }).map(mark => `${mark.name}×${mark.count}`).join(' · '), [attachments]);
  const usage = useMemo(() => {
    const excluded = new Set(excludedAttachmentIds ?? []);
    let tool = 0;
    let toolSteps = 0;
    let forwardedSteps = 0;
    for (const attachment of attachments ?? []) {
      if (!isToolStep(attachment)) continue;
      tool += countTokens(attachment.content);
      toolSteps++;
      if (!excluded.has(attachment.id)) forwardedSteps++;
    }
    const recordedCount = reasoningTokens?.[responseIndex];
    const hasThinking = !!reasonings?.[responseIndex]
      || (typeof recordedCount === 'number' && Number.isFinite(recordedCount) && recordedCount >= 0);
    const think = hasThinking ? thinkingTokens({ reasonings, reasoningTokens, responseIndex }) : 0;
    const q = countTokens(question);
    const a = countTokens(response);
    return { q, a, tool, think, hasThinking, total: q + a + tool + think, toolSteps, forwardedSteps };
  }, [question, response, attachments, excludedAttachmentIds, reasonings, reasoningTokens, responseIndex]);

  const parts = [
    { key: 'question', label: t('insight.usageQuestion'), value: usage.q },
    { key: 'answer', label: t('insight.usageAnswer'), value: usage.a },
    { key: 'tool', label: t('insight.usageTools'), value: usage.tool },
    { key: 'think', label: t('insight.usageThinking'), value: usage.think },
  ];
  // Paint one continuous surface. Separate scaled rectangles can acquire
  // different antialiased edges even when their layout heights are equal.
  let accumulated = 0;
  const colorStops = parts.filter(part => part.value > 0).map(part => {
    const start = accumulated / usage.total * 100;
    accumulated += part.value;
    const end = accumulated / usage.total * 100;
    return `var(--node-usage-${part.key}) ${start}% ${end}%`;
  });
  const total = `≈ ${numberFormat.format(usage.total)} tokens`;
  const toolCountLabel = fmt(t('insight.toolCalls'), { n: usage.toolSteps });
  const notes = [t('insight.usageEstimate')];
  if (usage.toolSteps > 0) notes.push(
    `${toolCountLabel} · ${toolTitle}`,
    fmt(t('insight.usageForwarded'), { k: usage.forwardedSteps, n: usage.toolSteps }),
  );
  notes.push(t('insight.usageThinkingNote'));
  const details: TooltipDetails = {
    title: t('insight.usageTitle'),
    total,
    rows: parts.map((part) => {
      const missing = part.key === 'think' && !usage.hasThinking;
      return {
        label: part.label,
        value: missing ? t('insight.usageUnrecorded') : numberFormat.format(part.value),
        share: missing ? '—' : shareOf(part.value, usage.total),
        color: `var(--node-usage-${part.key})`,
      };
    }),
    note: notes.join('\n'),
  };
  const fallback = [
    `${details.title} · ${total}`,
    ...details.rows.map((row) => `${row.label} ${row.value}${row.share === '—' ? '' : ` · ${row.share}`}`),
    details.note,
  ].join('\n');

  return (
    <span
      className="node-token-usage"
      role="group"
      tabIndex={0}
      title={fallback}
      aria-label={`${details.title} · ${total}${usage.toolSteps > 0 ? ` · ${toolCountLabel}` : ''}`}
      data-node-token-usage
      data-tooltip-details={JSON.stringify(details)}
    >
      <span className="node-token-heading">
        <span className="node-token-total" data-node-token-total>{total}</span>
        {usage.toolSteps > 0 && <span className="node-tool-marks" data-tool-marks>
          <Wrench size={13} strokeWidth={1.75} aria-hidden="true" />
          {numberFormat.format(usage.toolSteps)}
        </span>}
      </span>
      <span className="node-token-bar" data-comp-bar aria-hidden="true"
        style={{ backgroundImage: colorStops.length ? `linear-gradient(to right, ${colorStops.join(', ')})` : undefined }} />
    </span>
  );
});
