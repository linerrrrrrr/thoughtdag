import { Paperclip } from 'lucide-react';
import type { ThoughtData } from '../../types';

export default function NodeInfoLine({ data }: { data: ThoughtData }) {
  const attachCount = (data.attachments || []).length;
  return (
    <div className="flex items-center gap-1.5 text-control text-ink-muted min-w-0 h-8" data-node-info>
      <span className="shrink-0">{data.tokenCount} tokens</span>
      {attachCount > 0 && (
        <>
          <span className="shrink-0">·</span>
          <span className="shrink-0 flex items-center gap-0.5">
            <Paperclip size={11} strokeWidth={1.75} /> {attachCount}
          </span>
        </>
      )}
    </div>
  );
}
