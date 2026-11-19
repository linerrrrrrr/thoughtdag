import { useId, type ButtonHTMLAttributes } from 'react';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  label: string;
  checked: boolean;
  onChange: () => void;
};

export default function CanvasSettingSwitch({ label, checked, onChange, ...attributes }: Props) {
  const id = useId();
  return <div className="canvas-routing-toggle">
    <label htmlFor={id} className="text-control font-medium">{label}</label>
    <button {...attributes} id={id} type="button" role="switch" aria-checked={checked}
      onClick={onChange} className="canvas-routing-switch">
      <span className="canvas-routing-switch-track"><span /></span>
    </button>
  </div>;
}
