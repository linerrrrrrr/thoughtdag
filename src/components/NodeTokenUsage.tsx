import { memo, useMemo } from 'react';
import { Wrench } from 'lucide-react';
import { fmt, useT } from '../i18n';
import { isToolStep, thinkingTokens } from '../lib/turn-insight';
import type { ThoughtData } from '../types';
import { countTokens } from '../utils';
import './NodeTokenUsage.css';

const numberFormat = new Intl.NumberFormat('en-US');

export default memo(function NodeTokenUsage({ data }: { data: ThoughtData }) {
  const t = useT();
  const { question, response, attachments, reasonings, reasoningTokens, responseIndex } = data;
  const usage = useMemo(() => {
    let tool = 0;
    let toolSteps = 0;
    for (const attachment of attachments ?? []) {
      if (!isToolStep(attachment)) continue;
      tool += countTokens(attachment.content);
      toolSteps++;
    }
    const recordedCount = reasoningTokens?.[responseIndex];
    const hasThinking = !!reasonings?.[responseIndex]
      || (typeof recordedCount === 'number' && Number.isFinite(recordedCount) && recordedCount >= 0);
    const think = hasThinking ? thinkingTokens({ reasonings, reasoningTokens, responseIndex }) : 0;
    const q = countTokens(question);
    const a = countTokens(response);
    return { q, a, tool, think, total: q + a + tool + think, toolSteps };
  }, [question, response, attachments, reasonings, reasoningTokens, responseIndex]);

  const parts = [
    { key: 'question', value: usage.q },
    { key: 'answer', value: usage.a },
    { key: 'tool', value: usage.tool },
    { key: 'think', value: usage.think },
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

  return (
    <span
      className="node-token-usage"
      role="group"
      aria-label={`${t('insight.usageTitle')} · ${total}${usage.toolSteps > 0 ? ` · ${toolCountLabel}` : ''}`}
      data-node-token-usage
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
