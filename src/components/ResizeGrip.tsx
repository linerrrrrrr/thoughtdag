import './NodeResizeControls.css';

export type ResizeDirection = 'width' | 'height' | 'both';

/** One lightweight mark for both node-local and selection-boundary controls. */
export default function ResizeGrip({ direction }: { direction: ResizeDirection }) {
  return direction === 'both'
    ? <svg className="resize-grip resize-grip-both" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M3 11 11 3M8 11 11 8" />
    </svg>
    : <span className={`resize-grip resize-grip-${direction}`} aria-hidden="true" />;
}
