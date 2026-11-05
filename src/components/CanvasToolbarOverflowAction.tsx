import { useContext, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CanvasToolbarOverflowContext } from '../lib/use-responsive-canvas-header';

/** Only the entry moves into More; the owning component and its drafts stay mounted. */
export default function CanvasToolbarOverflowAction({ children, label, icon }: {
  children: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
  label: string;
  icon: ReactNode;
}) {
  const { target, close } = useContext(CanvasToolbarOverflowContext);
  return <>
    <span className="canvas-toolbar-minimal-secondary contents">{children}</span>
    {target && createPortal(<button type="button" disabled={children.props.disabled}
      onClick={event => { close(); children.props.onClick?.(event); }}
      className="w-full text-left px-3 py-2 text-xs text-ink hover:bg-wash disabled:opacity-30 flex items-center gap-2.5">
      {icon}<span>{label}</span>
    </button>, target)}
  </>;
}
