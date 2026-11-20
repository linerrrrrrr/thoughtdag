import { Blocks, Brain, Cpu, Monitor, PanelsTopLeft, Spline, SquareTerminal } from 'lucide-react';
import { useT } from '../../i18n';
import type { SettingsSection } from '../../lib/ui-store';

const groups = [
  { title: 'settings.canvas', items: [
    { id: 'general', icon: Monitor }, { id: 'nodes', icon: PanelsTopLeft }, { id: 'edges', icon: Spline },
  ] },
  { title: 'settings.execution', items: [
    { id: 'providers', icon: Cpu }, { id: 'agents', icon: SquareTerminal },
    { id: 'judge', icon: Brain }, { id: 'tools', icon: Blocks },
  ] },
] as const;

export default function SettingsNavigation({ section, onChange }: {
  section: SettingsSection; onChange: (section: SettingsSection) => void;
}) {
  const t = useT();
  return <>
    <nav aria-label={t('settings.category')} className="settings-navigation">
      {groups.map(group => <div key={group.title} className="settings-nav-group">
        <h3 className="text-control">{t(group.title)}</h3>
        {group.items.map(({ id, icon: Icon }) => <button key={id} type="button"
          aria-current={section === id ? 'page' : undefined} data-settings-section={id} onClick={() => onChange(id)}>
          <Icon size={16} strokeWidth={1.75} aria-hidden="true" />{t(`settings.${id}`)}
        </button>)}
      </div>)}
    </nav>
    <select aria-label={t('settings.category')} data-settings-select className="settings-mobile-nav text-control"
      value={section} onChange={event => onChange(event.target.value as SettingsSection)}>
      {groups.map(group => <optgroup key={group.title} label={t(group.title)}>
        {group.items.map(({ id }) => <option key={id} value={id}>{t(`settings.${id}`)}</option>)}
      </optgroup>)}
    </select>
  </>;
}
