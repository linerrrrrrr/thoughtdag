// The bottom-right card of a running "update node summaries" job: how many
// of how many, on which model, a thin bar, and a Stop button. When the job
// ends it states the tally and leaves after a few seconds, or on Close.
import { useEffect } from 'react';
import { Layers, Square, X } from 'lucide-react';
import { useUiStore } from '../../lib/ui-store';
import { stopLadderJob, dismissLadderJob } from '../../lib/ladder-reselect';
import { useT, fmt } from '../../i18n';

export default function LadderJobCard() {
  const t = useT();
  const job = useUiStore((s) => s.ladderJob);
  useEffect(() => {
    if (!job || job.running) return;
    const id = setTimeout(dismissLadderJob, 8000);
    return () => clearTimeout(id);
  }, [job]);
  if (!job) return null;
  const progress = job.total ? Math.min(1, (job.done + job.failed) / job.total) : 1;
  return (
    <div className="fixed bottom-4 right-4 z-[85] w-[300px] bg-card border border-line rounded-panel shadow-lg px-4 py-3 animate-fade-in" data-ladder-job data-ladder-job-running={job.running ? 'yes' : 'no'}>
      <div className="flex items-center gap-2">
        <Layers size={14} strokeWidth={1.75} className="text-accent shrink-0" />
        <span className="text-control font-medium text-ink flex-1">{t('ladder.jobTitle')}</span>
        {job.running
          ? <button onClick={stopLadderJob} disabled={job.cancelled} className="flex items-center gap-1 text-control text-ink-muted hover:text-red-600 disabled:opacity-50" data-ladder-job-stop><Square size={10} strokeWidth={1.75} fill="currentColor" /> {job.cancelled ? t('ladder.jobStopping') : t('ladder.jobStop')}</button>
          : <button onClick={dismissLadderJob} className="text-ink-faint hover:text-ink" title={t('ladder.jobClose')} data-ladder-job-close><X size={13} strokeWidth={1.75} /></button>}
      </div>
      <div className="mt-2 h-1 rounded-content bg-wash overflow-hidden"><div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <p className="mt-1.5 text-control text-ink-muted tabular-nums" data-ladder-job-line>
        {job.running
          ? fmt(t('ladder.jobProgress'), { n: job.done + job.failed, m: job.total, model: job.model })
          : (job.cancelled ? fmt(t('ladder.jobStopped'), { n: job.done }) : fmt(t('ladder.jobDone'), { n: job.done, k: job.skipped })) + (job.failed ? fmt(t('ladder.jobFailed'), { f: job.failed }) : '')}
      </p>
      {!job.running && job.failed > 0 && job.lastError && <p className="mt-1 text-control text-red-500 break-words" data-ladder-job-error>{job.lastError}</p>}
    </div>
  );
}
