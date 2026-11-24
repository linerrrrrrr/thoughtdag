import { Globe, GraduationCap, Wrench } from 'lucide-react';
import type { ThoughtData } from '../../types';
import { useT } from '../../i18n';

export default function ToolProgressLine({ progress }: { progress: NonNullable<ThoughtData['toolProgress']> }) {
  const t = useT();
  const scholarly = progress.name === 'arxiv_search' || progress.name === 'semantic_scholar';
  const web = progress.name === 'web_search';
  const Icon = scholarly ? GraduationCap : web ? Globe : Wrench;
  const label = scholarly ? t('caps.scholar') : web ? t('caps.webSearch') : progress.name?.trim() || t('activity.tool');
  const query = progress.query?.trim();
  return <div role="status" data-tool-progress={progress.name || 'tool'} className="flex items-start gap-2 text-body text-ink-muted">
    <Icon size={14} strokeWidth={1.75} className="shrink-0 mt-1" aria-hidden />
    <span className="min-w-0 whitespace-pre-wrap break-words">
      {query && <span className="sr-only">{label} </span>}
      {query ? query + '…' : web ? t('node.gatewaySearching') : label + '…'}
    </span>
  </div>;
}
