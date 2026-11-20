import { useId } from 'react';
import { useT } from '../i18n';
import { CONNECTION_LAYOUTS, useConnectionLayoutPreferences, type ConnectionLayout } from '../lib/connection-layout-preferences';
import CanvasSettingSwitch from './CanvasSettingSwitch';
import './ConnectionLayoutControls.css';

function LayoutSample({ layout }: { layout: ConnectionLayout }) {
  const top = layout === 'top';
  const dock = layout === 'dock';
  return <svg width="76" height="42" className="max-w-full" viewBox="0 0 76 42" fill="none" aria-hidden="true">
    <g stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <rect x={dock ? 33 : 14} y="7" width={dock ? 35 : 54} height="29" rx="4" fill="var(--color-card)" />
      {dock ? <>
        <path d="M25 17 H33" />
        <rect x="10" y="10" width="15" height="19" rx="2" fill="var(--color-wash)" />
      </> : <path d={top ? 'M14 17 H68' : 'M30 7 V36'} />}
      <path d={top ? 'M32 1 Q34 6 41 7 M50 1 Q48 6 41 7 M41 36 V41'
        : dock ? 'M1 11 Q4 17 10 17 M1 24 Q5 18 10 17 M68 19 H75'
        : 'M2 10 Q7 17 14 17 M2 25 Q7 18 14 17 M68 19 H75'} />
      <circle cx={top ? 41 : dock ? 10 : 14} cy={top ? 7 : 17} r="2.3" fill="currentColor" />
      <circle cx={top ? 41 : 68} cy={top ? 36 : 19} r="2.3" fill="var(--color-card)" />
    </g>
  </svg>;
}

export default function ConnectionLayoutControls({ showDescriptions = true }: { showDescriptions?: boolean }) {
  const t = useT();
  const group = useId();
  const settings = useConnectionLayoutPreferences(state => state.settings);
  const setSettings = useConnectionLayoutPreferences(state => state.setSettings);
  return <section className="grid min-w-0" data-connection-layout-settings>
    <CanvasSettingSwitch label={t('connectionLayout.enabled')} checked={settings.enabled} data-connection-layout-enabled
      onChange={() => setSettings({ enabled: !settings.enabled })} />
    {settings.enabled && <>
      <fieldset className="canvas-layout-field">
        <legend>{t('connectionLayout.structure')}</legend>
        <div className="canvas-layout-choices connection-layout-options">
          {CONNECTION_LAYOUTS.map(layout => <label key={layout} className="canvas-layout-choice">
            <input type="radio" name={group} value={layout} checked={settings.layout === layout}
              onChange={() => setSettings({ layout })} data-connection-layout-choice={layout} />
            <span><LayoutSample layout={layout} />
              <span className="connection-layout-option-copy"><span>{t(`connectionLayout.${layout}`)}</span>
                {showDescriptions && <span className="connection-layout-option-hint">{t(`connectionLayout.${layout}Hint`)}</span>}
              </span>
            </span>
          </label>)}
        </div>
      </fieldset>
      <CanvasSettingSwitch label={t('connectionLayout.attachments')} checked={settings.showAttachments}
        data-connection-layout-attachments onChange={() => setSettings({ showAttachments: !settings.showAttachments })} />
    </>}
  </section>;
}
