import { useId, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { useT } from '../../i18n';
import { toast } from '../../lib/ui-store';
import { refreshModelCatalog } from '../../lib/use-models';
import './CanvasModelMenu.css';

type View = 'models' | 'settings';

export default function CanvasModelMenu({ models, settings }: { models: ReactNode; settings: ReactNode }) {
  const t = useT();
  const id = useId();
  const [view, setView] = useState<View>('models');
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try { await refreshModelCatalog(); }
    catch { toast('error', t('model.refreshFailed')); }
    finally { setRefreshing(false); }
  };

  return <>
    <div className="canvas-model-menu-header">
      <div role="tablist" aria-label={t('toolbar.model')} className="canvas-model-tabs">
        {(['models', 'settings'] as const).map(tab => (
          <button key={tab} type="button" role="tab" id={`${id}-${tab}`} data-picker-view={tab}
            aria-controls={`${id}-${tab}-panel`} aria-selected={view === tab} tabIndex={view === tab ? 0 : -1}
            className="text-control" onClick={() => setView(tab)}
            onKeyDown={event => {
              if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
              let next: View;
              switch (event.key) {
                case 'Home': next = 'models'; break;
                case 'End': next = 'settings'; break;
                case 'ArrowRight': case 'ArrowLeft': next = tab === 'models' ? 'settings' : 'models'; break;
                default: return;
              }
              event.preventDefault();
              event.stopPropagation();
              setView(next);
              document.getElementById(`${id}-${next}`)?.focus();
            }}>
            {t(tab === 'models' ? 'model.catalogTab' : 'model.settingsTab')}
          </button>
        ))}
      </div>
      {view === 'models' && <button type="button" className="canvas-model-refresh" disabled={refreshing}
        data-model-refresh aria-label={t('model.refreshList')} data-tooltip={t('model.refreshList')} onClick={() => void refresh()}>
        <RefreshCw size={15} strokeWidth={1.75} aria-hidden="true" className={refreshing ? 'animate-spin' : undefined} />
      </button>}
    </div>
    <div role="tabpanel" id={`${id}-models-panel`} aria-labelledby={`${id}-models`} hidden={view !== 'models'}
      className="canvas-model-menu-body">{models}</div>
    <div role="tabpanel" id={`${id}-settings-panel`} aria-labelledby={`${id}-settings`} hidden={view !== 'settings'}
      className="canvas-model-menu-body">{view === 'settings' && settings}</div>
  </>;
}
