import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDownToLine, Check, ChevronDown, ChevronRight, FileText, Link2Off, MessageSquare, Minus, Paperclip, X } from 'lucide-react';
import { useStore } from '../store';
import { fmt, useT } from '../i18n';
import { useConnectionLayoutPreferences } from '../lib/connection-layout-preferences';
import { useContextInspection } from '../lib/context-inspection';
import { getNodeNameSource } from '../lib/node-display-name';
import { changedInputFiles, inputGraph } from '../lib/node-input-sources';
import { isContentKind } from '../lib/content';
import { useUiStore } from '../lib/ui-store';
import { isViewerMode } from '../lib/viewer';
import type { Attachment, ThoughtEdge, ThoughtNode } from '../types';
import './NodeInputRegion.css';
import NodeContextSources from './NodeContextSources';

type SourceKind = 'conversation' | 'material' | 'local' | 'inherited';
interface SourceRow {
  kind: SourceKind;
  owner: ThoughtNode;
  edge?: ThoughtEdge;
  attachment?: Attachment;
  ancestorExcluded?: boolean;
}

function SourceGroup({ label, count, compact, children }: {
  label: string; count: number; compact: boolean; children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const heading = <><span>{label}</span><span className="input-source-count">{count}</span></>;
  if (compact || !count) return <div className="input-source-heading">{heading}</div>;
  return <section className="input-source-group">
    <button type="button" className="input-source-toggle input-source-heading" aria-expanded={expanded}
      onClick={() => setExpanded(!expanded)}>{heading}
      {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
    </button>
    {expanded && <ul className="input-source-list">{children}</ul>}
  </section>;
}

function endTrace(nodeId: string, edgeId?: string) {
  const state = useContextInspection.getState();
  if (state.inline && state.targetId === nodeId && (!edgeId || state.activeEdgeId === edgeId)) state.close();
}

/** Intake contents only. React Flow measures the separate, permanent port. */
export default function NodeInputRegion({ nodeId, compact = false, readOnly = false }: {
  nodeId: string; compact?: boolean; readOnly?: boolean;
}) {
  const t = useT();
  const graph = useStore(inputGraph);
  const settings = useConnectionLayoutPreferences(s => s.settings);
  const editable = !isViewerMode && !readOnly;
  const getInherited = useStore(s => s.getInheritedAttachments);
  const sources = useMemo(() => {
    const target = graph.byId.get(nodeId);
    const turns: SourceRow[] = [], materials: SourceRow[] = [], direct = new Set<string>(), files = new Set<string>();
    if (target) {
      for (const edge of graph.incoming.get(nodeId) ?? []) {
        const owner = graph.byId.get(edge.source);
        if (!owner || owner.data.stepKind === 'frame') continue;
        if (isContentKind(owner.data.stepKind)) {
          direct.add(owner.id);
          if (settings.showAttachments) {
            const attachment = owner.data.stepKind === 'file' ? owner.data.attachments?.[0] : undefined;
            materials.push({ kind: 'material', owner, edge, attachment });
            if (attachment) files.add(owner.id);
          }
        } else turns.push({ kind: 'conversation', owner, edge });
      }
      if (settings.showAttachments) {
        for (const attachment of target.data.attachments ?? []) materials.push({ kind: 'local', owner: target, attachment });
        for (const inherited of getInherited(nodeId)) {
          const owner = graph.byId.get(inherited.sourceNodeId);
          if (!owner || direct.has(owner.id)) continue;
          materials.push({ kind: 'inherited', owner, attachment: inherited.attachment, ancestorExcluded: inherited.excludedByAncestor });
          if (owner.data.stepKind === 'file') files.add(owner.id);
        }
      }
    }
    const changed = target && !compact ? changedInputFiles(target, files, graph) : new Set<string>();
    return { target, turns, materials, changed };
  }, [graph, nodeId, compact, settings.showAttachments, getInherited]);
  useEffect(() => () => endTrace(nodeId), [nodeId]);
  if (!sources.target) return null;
  const data = sources.target.data;
  const renderRow = (row: SourceRow) => {
    const { kind, owner, attachment, edge } = row;
    const sourceName = getNodeNameSource(owner.data, t('ctx.unnamedNode'));
    const name = attachment?.name || sourceName;
    let origin = '';
    if (kind === 'material') origin = t(owner.data.stepKind === 'file' ? 'inputRegion.sharedFile' : 'inputRegion.material');
    if (kind === 'conversation' && edge?.data?.isCrossLink) origin = t('inputRegion.reference');
    if (kind === 'local') origin = t('inputRegion.local');
    if (kind === 'inherited') origin = fmt(t('inputRegion.inherited'), { name: sourceName });
    const excluded = !!attachment && (data.excludedAttachmentIds?.includes(attachment.id) ||
      (row.ancestorExcluded && !data.includedAttachmentIds?.includes(attachment.id)));
    const trace = () => { if (edge) useContextInspection.getState().trace(nodeId, edge.id); };
    const onOpen = () => {
      if (kind === 'conversation') { trace(); return; }
      useUiStore.getState().setReaderNodeId(owner.id, attachment ? { attachmentId: attachment.id } : undefined);
    };
    const openLabel = fmt(t(kind === 'conversation' ? 'inputRegion.trace' : 'inputRegion.open'), { name });
    const actionLabel = fmt(t(edge ? 'inputRegion.disconnect' : 'inputRegion.remove'), { name });
    return <li key={edge?.id ?? `${kind}-${owner.id}-${attachment?.id}`} className="input-source-row"
      data-input-source-kind={kind} data-input-source-id={owner.id} data-input-edge-id={edge?.id}
      data-input-excluded={excluded || undefined}
      onPointerEnter={trace} onPointerLeave={event => {
        if (!event.currentTarget.contains(document.activeElement)) endTrace(nodeId, edge?.id);
      }}
      onFocus={trace} onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) endTrace(nodeId, edge?.id);
      }}>
      <button type="button" className="input-source-open" aria-label={openLabel} data-tooltip={name} onClick={onOpen}>
        <span className="input-source-icon" aria-hidden="true">{kind === 'conversation'
          ? <MessageSquare size={14} strokeWidth={1.6} /> : kind === 'local' || kind === 'inherited'
            ? <Paperclip size={14} strokeWidth={1.6} /> : <FileText size={14} strokeWidth={1.6} />}</span>
        <span className="input-source-copy">
        <span className="input-source-name" data-tooltip={name} data-tooltip-overflow>{name}</span>
        {origin && <span className="input-source-origin">{origin}</span>}
        {kind === 'inherited' && <span className="input-source-origin">{t(excluded ? 'inputRegion.unused' : 'inputRegion.used')}</span>}
        </span>
      </button>
      {editable && kind === 'inherited' && attachment ? <button type="button" className="input-source-action"
        aria-label={t(excluded ? 'attach.titleInclude' : 'attach.titleExclude')} aria-pressed={!excluded}
        data-tooltip={t(excluded ? 'attach.titleInclude' : 'attach.titleExclude')}
        onClick={() => useStore.getState().toggleExcludeAttachment(nodeId, attachment.id, row.ancestorExcluded)}>
        {excluded ? <Minus size={14} /> : <Check size={14} />}
      </button> : editable && (edge || kind === 'local') && <button type="button" className="input-source-action"
        aria-label={actionLabel} data-tooltip={actionLabel} onClick={() => {
          endTrace(nodeId);
          if (edge) useStore.getState().deleteEdges([edge.id]);
          else if (attachment) useStore.getState().removeAttachment(nodeId, attachment.id);
        }}>{edge ? <Link2Off size={14} /> : <X size={14} />}</button>}
      {sources.changed.has(owner.id) && <small className="input-source-change" data-input-file-changed>{t('inputRegion.fileChanged')}</small>}
    </li>;
  };
  return <div className="node-input-region nodrag nopan nowheel" data-node-input-region={nodeId}
    data-input-compact={compact || undefined}
    onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
    <div className="node-input-heading"><ArrowDownToLine size={14} strokeWidth={1.6} aria-hidden="true" />
      <span>{t('inputRegion.intake')}</span><span className="node-input-total">{sources.turns.length + sources.materials.length}</span>
      {!compact && <NodeContextSources nodeId={nodeId} compact />}
    </div>
    <div className="node-input-groups">
    <SourceGroup label={t('inputRegion.upstream')} count={sources.turns.length} compact={compact}>
      {!compact && sources.turns.map(renderRow)}
    </SourceGroup>
    {settings.showAttachments && <SourceGroup label={t('inputRegion.materials')} count={sources.materials.length} compact={compact}>
      {!compact && sources.materials.map(renderRow)}
    </SourceGroup>}
    </div>
  </div>;
}
