import { useId } from 'react';

type Props<V extends string> = {
  label: string;
  value: V;
  choices: { value: V; label: string; disabled?: boolean }[];
  disabled?: boolean;
  onChange: (value: V) => void;
};

export default function CanvasLayoutChoices<V extends string>({ label, value, choices, onChange, ...attributes }: Props<V>) {
  const name = useId();
  return <fieldset className="canvas-layout-field" {...attributes} data-cursor="native">
    <legend>{label}</legend>
    <div className="canvas-layout-choices" style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}>
      {choices.map(choice => <label key={choice.value} className="canvas-layout-choice">
        <input type="radio" name={name} value={choice.value} checked={value === choice.value}
          disabled={choice.disabled} onChange={() => onChange(choice.value)} />
        <span>{choice.label}</span>
      </label>)}
    </div>
  </fieldset>;
}
