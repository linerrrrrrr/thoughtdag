import { useState, type ReactNode } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { SettingsIcon } from '../../lib/ui-icons';
import { useT } from '../../i18n';
import { toast } from '../../lib/ui-store';
import { refreshModelCatalog } from '../../lib/use-models';
import './CanvasModelMenu.css';

export default function CanvasModelMenu({ models, onSettings }: { models: ReactNode; onSettings: () => void }) {
  const t = useT();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try { await refreshModelCatalog(); }
    catch { toast('error', t('model.refreshFailed')); }
    finally { setRefreshing(false); }
  };

  return <>
    <div className="canvas-model-menu-header">
      <h2 className="text-title font-semibold text-ink">{t('settingsAI.defaultModel')}</h2>
      <button type="button" className="canvas-model-refresh" disabled={refreshing}
        data-model-refresh aria-label={t('model.refreshList')} data-tooltip={t('model.refreshList')} onClick={() => void refresh()}>
        <RefreshCw size={15} strokeWidth={1.75} aria-hidden="true" className={refreshing ? 'animate-spin' : undefined} />
      </button>
    </div>
    <div className="canvas-model-menu-body">{models}</div>
    <div className="shrink-0 border-t border-line p-2">
      <button type="button" onClick={onSettings} data-model-settings-entry
        className="flex min-h-8 w-full items-center gap-2 rounded-control px-2 py-1 text-left text-control text-ink-muted hover:bg-wash hover:text-ink">
        <SettingsIcon size={15} strokeWidth={1.75} aria-hidden="true" />
        <span className="flex-1">{t('settingsAI.modelSettings')}</span>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
    </div>
  </>;
}
