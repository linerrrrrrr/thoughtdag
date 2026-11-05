import { Globe, GraduationCap } from 'lucide-react';
import { hasWhy } from '../../lib/why-bridge';
import { useUiStore } from '../../lib/ui-store';
import { useStore } from '../../store';
import RecallChip from './RecallChip';
import { useModels } from '../../lib/use-models';
import { directWithoutSearch } from '../../lib/direct-llm';
import { useT } from '../../i18n';

// Per-ask search permissions, shown next to every input that asks. The two
// toggles edit the shared default (ui-store, persisted); each new node
// snapshots them at creation, so reruns keep behaving the same way.
// With a `nodeId` the toggles are that node's own snapshot instead (shown in
// its question editor): what its re-asks run with, the defaults where the
// node has none; changing them changes the node, never the defaults.
export default function SearchToggles({ size = 16, nodeId }: { size?: number; nodeId?: string }) {
  const webDefault = useUiStore((s) => s.webSearchEnabled);
  const setWebDefault = useUiStore((s) => s.setWebSearchEnabled);
  const scholarDefault = useUiStore((s) => s.scholarSearchEnabled);
  const setScholarDefault = useUiStore((s) => s.setScholarSearchEnabled);
  const nodeWeb = useStore((s) => (nodeId ? s.nodes.find((n) => n.id === nodeId)?.data.webSearch : undefined));
  const nodeScholar = useStore((s) => (nodeId ? s.nodes.find((n) => n.id === nodeId)?.data.scholarSearch : undefined));
  const patchNode = (p: { webSearch?: boolean; scholarSearch?: boolean }) =>
    useStore.setState((s) => ({ nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...p } } : n)) }));
  const web = nodeId ? (nodeWeb ?? webDefault) : webDefault;
  const scholar = nodeId ? (nodeScholar ?? scholarDefault) : scholarDefault;
  const setWeb = (v: boolean) => (nodeId ? patchNode({ webSearch: v }) : setWebDefault(v));
  const setScholar = (v: boolean) => (nodeId ? patchNode({ scholarSearch: v }) : setScholarDefault(v));
  // recall: the why layer's exact words from past conversations and memories,
  // brought into the ask as listed items; only where a local index answers
  const recallAvailable = hasWhy();
  const t = useT();
  // no key, no button: search that cannot run must not be offerable
  // (the capabilities panel is the one place that says why)
  const webAvailable = useModels()?.capabilities?.webSearch ?? true;
  // Models on a searchless direct lane (hosted app, e.g. DeepSeek browser-
  // direct) show DISABLED toggles with the reason — a control that vanishes
  // reads as a missing feature, a disabled one explains itself. Offering a
  // live toggle would route the request through the proxy, where thinking
  // streams die of the Workers CPU allowance.
  const selectedModel = useUiStore((s) => s.selectedModel);
  const noSearchLane = directWithoutSearch(selectedModel ?? undefined);

  const cls = (on: boolean) =>
    noSearchLane
      ? 'transition-colors shrink-0 rounded-control w-8 h-8 flex items-center justify-center text-ink-faint opacity-30 cursor-not-allowed'
      : `transition-colors shrink-0 rounded-control w-8 h-8 flex items-center justify-center ${
          on
            ? 'text-accent bg-accent/15 ring-1 ring-accent/40 hover:bg-accent/25'
            : 'text-ink-muted opacity-50 hover:opacity-90 hover:bg-line'
        }`;

  return (
    <>
      {webAvailable && (
        <button
          type="button"
          onClick={() => { if (!noSearchLane) setWeb(!web); }}
          disabled={noSearchLane}
          aria-pressed={web}
          aria-label={t('toolbar.webSearch')}
          title={noSearchLane ? t('toolbar.searchUnavailableLane') : web ? t('toolbar.webSearch') : t('toolbar.webSearchOff')}
          className={cls(web)}
          data-web-toggle
        >
          <Globe size={size} strokeWidth={1.75} />
        </button>
      )}
      <button
        type="button"
        onClick={() => { if (!noSearchLane) setScholar(!scholar); }}
        disabled={noSearchLane}
        aria-pressed={scholar}
        aria-label={t('toolbar.scholarSearch')}
        title={noSearchLane ? t('toolbar.searchUnavailableLane') : scholar ? t('toolbar.scholarSearch') : t('toolbar.scholarSearchOff')}
        className={cls(scholar)}
        data-scholar-toggle
      >
        <GraduationCap size={size} strokeWidth={1.75} />
      </button>
      {recallAvailable && (
        // recall is a quiet chip after a hairline, not a third search icon: it
        // names itself and its reach, and opens the menu (switch, reach, amount)
        <>
          <span className="w-px h-4 bg-line mx-0.5 shrink-0" aria-hidden />
          <RecallChip nodeId={nodeId} />
        </>
      )}
    </>
  );
}
