import type { ReactNode } from 'react';
import { useLadderLevel } from '../lib/use-map-mode';
import './NodeOverview.css';

/** Overview is wayfinding: a stable name, with a quiet preview only when close. */
export default function NodeOverview({ name, source, preview, previewAlways = false, icon, action, meta, compact = false, variant = 'thought', typeLabel, fileTypes }: {
  name: string;
  source?: string;
  preview?: string;
  previewAlways?: boolean;
  icon?: ReactNode;
  action?: ReactNode;
  meta?: string;
  compact?: boolean;
  variant?: 'thought' | 'start' | 'note' | 'file' | 'link';
  typeLabel?: string;
  fileTypes?: string[];
}) {
  const level = useLadderLevel();
  const showPreview = !compact && (previewAlways || level === 3);
  const text = preview?.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#*`>]/g, '').replace(/\s+/g, ' ').trim();
  return (
    <div className={`node-overview node-overview--${variant}${compact ? ' node-overview--compact' : ''}`} data-node-overview data-overview-detail={showPreview ? 'preview' : 'name'}>
      {((typeLabel && !compact) || !!fileTypes?.length) && <div className="node-overview-identity">
        {!compact && typeLabel && <span>{typeLabel}</span>}
        {fileTypes?.slice(0, compact ? 1 : 3).map(type => <span className="node-file-type" key={type}>{type}</span>)}
      </div>}
      <div className="node-overview-heading">
        {icon && <span className="node-overview-icon" aria-hidden="true">{icon}</span>}
        <div className="node-overview-name" title={source || name} data-node-name>{name}</div>
        {action && <div className="node-overview-action">{action}</div>}
      </div>
      {showPreview && text && text !== name && <p className="node-overview-preview" data-node-preview>{text.slice(0, 240)}</p>}
      {showPreview && meta && <div className="node-overview-meta" title={meta}>{meta}</div>}
    </div>
  );
}
