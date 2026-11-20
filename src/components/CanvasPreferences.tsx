import { useId, type ReactNode } from 'react';
import { useT } from '../i18n';
import { useAppearance } from '../lib/appearance';
import { useUiStore } from '../lib/ui-store';
import { CanvasDetailChoices } from './CanvasDetailControl';
import CanvasSettingSwitch from './CanvasSettingSwitch';
import ConnectionLayoutControls from './ConnectionLayoutControls';
import CanvasTypographySettings from './ui/CanvasTypographySettings';
import LangSwitch from './ui/LangSwitch';
import './CanvasLayoutPanel.css';
import './ui/SettingsFields.css';

export function NodePreferences() {
  const t = useT();
  const detail = useUiStore(state => state.canvasDetail);
  const setDetail = useUiStore(state => state.setCanvasDetail);
  return <div className="min-w-0" data-node-preferences>
    <div className="settings-field-section">
      <div className="settings-node-detail">
        <CanvasDetailChoices title={t('detail.global')} value={detail} onChange={setDetail} />
      </div>
      <ConnectionLayoutControls />
    </div>
    <CanvasTypographySettings />
  </div>;
}

function AppearanceChoices<T extends string>({ title, value, options, preview, onChange }: {
  title: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  preview: (value: T) => ReactNode;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return <div className="settings-field-row">
    <span id={id} className="settings-field-title">{title}</span>
    <div role="group" aria-labelledby={id} className="settings-appearance-choice flex overflow-hidden rounded-control border border-line text-control">
      {options.map(([choice, label]) => <button type="button" key={choice} aria-pressed={choice === value}
        onClick={() => onChange(choice)}
        className="flex min-h-8 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1.5 py-2 text-ink-muted transition-colors hover:bg-wash not-first:border-l not-first:border-line aria-pressed:bg-accent/10 aria-pressed:font-medium aria-pressed:text-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
        {preview(choice)}{label}
      </button>)}
    </div>
  </div>;
}

export function InterfacePreferences() {
  const t = useT();
  const lighting = useAppearance(state => state.lighting);
  const paper = useAppearance(state => state.paper);
  const wheelPans = useUiStore(state => state.wheelPans);
  const annotationsHidden = useUiStore(state => state.annotationsHidden);
  return <div className="min-w-0" data-interface-preferences>
    <section className="settings-field-section">
      <h4 className="text-title font-semibold">{t('settingsCanvas.appearance')}</h4>
      <div className="settings-field-row" data-menu-language>
        <span className="settings-field-title">{t('lang.label')}</span>
        <div className="settings-appearance-choice"><LangSwitch variant="menu" /></div>
      </div>
      <div data-appearance-lighting>
        <AppearanceChoices title={t('settingsCanvas.theme')} value={lighting}
          options={[['light', t('appearance.light')], ['dark', t('appearance.dark')], ['system', t('appearance.system')]]}
          preview={choice => <span aria-hidden="true" className="settings-theme-sample" data-lighting={choice}>
            <span />{choice === 'system' && <span />}
          </span>}
          onChange={useAppearance.getState().setLighting} />
      </div>
      <div data-appearance-paper>
        <AppearanceChoices title={t('settingsCanvas.background')} value={paper}
          options={[['plain', t('appearance.plain')], ['grid', t('appearance.grid')]]}
          preview={choice => <span aria-hidden="true" className="settings-paper-sample" data-paper={choice} />}
          onChange={useAppearance.getState().setPaper} />
      </div>
    </section>
    <section className="settings-field-section">
      <h4 className="text-title font-semibold">{t('settingsCanvas.controls')}</h4>
      <CanvasSettingSwitch label={t('toolbar.menuWheelPans')} checked={wheelPans} data-wheel-pans
        description={t('settingsCanvas.wheelHint')}
        onChange={() => useUiStore.getState().setWheelPans(!wheelPans)} />
      <CanvasSettingSwitch label={t('toolbar.menuAnnotationsShow')} checked={!annotationsHidden}
        description={t('settingsCanvas.annotationsHint')} data-show-annotations
        onChange={() => useUiStore.getState().setAnnotationsHidden(!annotationsHidden)} />
    </section>
  </div>;
}
