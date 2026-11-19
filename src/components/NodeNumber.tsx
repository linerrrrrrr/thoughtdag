import { fmt, useT } from '../i18n';

export default function NodeNumber({ number }: { number?: number }) {
  const t = useT();
  if (number === undefined) return null;
  return <span data-node-number={number} data-tooltip={fmt(t('node.numberHint'), { n: number })}
    className="shrink-0 self-center whitespace-nowrap text-meta font-mono text-ink-muted">#{number}</span>;
}
