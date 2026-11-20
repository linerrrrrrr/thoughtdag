import { useId, type ButtonHTMLAttributes } from 'react';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  label: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
};

export default function CanvasSettingSwitch({ label, description, checked, onChange, ...attributes }: Props) {
  const id = useId();
  return <div className="canvas-routing-toggle">
    <div className="min-w-0">
      <label htmlFor={id} className="text-control font-medium">{label}</label>
      {description && <p id={`${id}-hint`} className="mt-1 text-control text-ink-muted">{description}</p>}
    </div>
    <button {...attributes} id={id} type="button" role="switch" aria-checked={checked}
      aria-describedby={[attributes['aria-describedby'], description && `${id}-hint`].filter(Boolean).join(' ') || undefined}
      onClick={onChange} className="canvas-routing-switch">
      <span className="canvas-routing-switch-track"><span /></span>
    </button>
  </div>;
}
