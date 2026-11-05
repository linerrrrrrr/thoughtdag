import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, LoaderCircle, Pencil, WandSparkles } from 'lucide-react';
import type { ThoughtData } from '../types';
import { useStore } from '../store';
import { useT } from '../i18n';
import { activeSummary, isImeComposing } from '../utils';
import { getNodeNameSource } from '../lib/node-display-name';
import { generateNodeMetadata } from '../lib/node-metadata';
import { useUiStore } from '../lib/ui-store';
import { useInlineEditDismiss } from '../lib/use-inline-edit-dismiss';
import { isViewerMode } from '../lib/viewer';
import './ConversationSurface.css';

const isGeometryControl = (target: EventTarget | null) => target instanceof Element
  && !!target.closest('.react-flow__resize-control, .react-flow__controls');

/** Title and summary form one explicit-save editing session, independent of the Q&A. */
export default function NodeMetadataEditor({ id, data, name, preview, overview, open, onOpenChange, variant = 'canvas' }: {
  id: string;
  data: ThoughtData;
  name: string;
  preview?: string;
  overview: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: 'canvas' | 'panel';
}) {
  const t = useT();
  const titleKey = `node-metadata-title:${id}`;
  const summaryKey = `node-metadata-summary:${id}`;
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const revisionRef = useRef(0);
  const initialRef = useRef({ title: '', summary: '' });
  const hasDraft = useUiStore(s => s.drafts[titleKey] !== undefined || s.drafts[summaryKey] !== undefined);
  const editorId = `node-metadata-${variant}-${id}`;
  const previewText = preview?.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#*`>]/g, '').replace(/\s+/g, ' ').trim();

  useEffect(() => () => requestRef.current?.abort(), []);
  // A changed answer must never receive a result generated from its old version.
  useEffect(() => () => requestRef.current?.abort(), [data.question, data.response, data.responseIndex]);

  const writeTitle = (value: string) => {
    revisionRef.current++;
    setTitle(value);
    useUiStore.getState().setDraft(titleKey, value, true);
  };
  const writeSummary = (value: string) => {
    revisionRef.current++;
    setSummary(value);
    useUiStore.getState().setDraft(summaryKey, value, true);
  };
  const begin = () => {
    if (isViewerMode || data.isLoading) return;
    const drafts = useUiStore.getState().drafts;
    initialRef.current = { title: getNodeNameSource(data, ''), summary: data.displaySummary ?? activeSummary(data) ?? '' };
    setTitle(drafts[titleKey] ?? initialRef.current.title);
    setSummary(drafts[summaryKey] ?? initialRef.current.summary);
    setError('');
    onOpenChange(true);
  };
  const close = (discard = false) => {
    requestRef.current?.abort();
    requestRef.current = null;
    setBusy(false);
    setError('');
    if (discard) {
      useUiStore.getState().setDraft(titleKey, '');
      useUiStore.getState().setDraft(summaryKey, '');
    }
    onOpenChange(false);
  };
  const save = () => {
    const current = useStore.getState().nodes.find(n => n.id === id);
    if (!current || current.data.isLoading) return;
    const cleanTitle = title.replace(/\s+/g, ' ').trim();
    const cleanSummary = summary.trim();
    // Opening and saving an untouched automatic label does not pin its value.
    const displayName = cleanTitle === initialRef.current.title.replace(/\s+/g, ' ').trim()
      ? current.data.displayName : cleanTitle || undefined;
    const displaySummary = cleanSummary === initialRef.current.summary.trim()
      ? current.data.displaySummary : cleanSummary;
    if (displayName !== current.data.displayName || displaySummary !== current.data.displaySummary) {
      useStore.getState().pushHistory();
      useStore.setState(s => ({ nodes: s.nodes.map(n => n.id === id
        ? { ...n, data: { ...n.data, displayName, displaySummary } } : n) }));
      useStore.getState().pushHistory();
    }
    close(true);
  };
  const generate = async () => {
    if (busy || data.isLoading || !(data.question.trim() || data.response.trim())) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const revision = revisionRef.current;
    setBusy(true);
    setError('');
    try {
      const result = await generateNodeMetadata(data.question, data.response, { model: data.model, signal: controller.signal });
      if (controller.signal.aborted || requestRef.current !== controller) return;
      if (revisionRef.current !== revision) { setError(t('node.metadataChanged')); return; }
      writeTitle(result.title);
      writeSummary(result.summary);
    } catch {
      if (!controller.signal.aborted) setError(t('node.metadataFailed'));
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setBusy(false);
      }
    }
  };
  const dismiss = useInlineEditDismiss({
    active: open, ref: editorRef, onOutside: () => close(), onCancel: () => close(true),
    restoreFocusRef: triggerRef,
    ignoreOutside: event => isGeometryControl(event.target), ignoreFocusOutside: isGeometryControl,
  });

  if (!open && overview) return (
    <div className="node-metadata-overview nodrag nopan" data-node-metadata>
      <button ref={triggerRef} type="button" onClick={begin} disabled={isViewerMode || data.isLoading}
        className="node-summary-preview"
        aria-label={t('node.metadataEdit')} aria-expanded={false} data-node-metadata-toggle>
        <span className="node-summary-heading">
          <span className="node-summary-name" title={name} data-node-name>{name}</span>
          {!isViewerMode && <Pencil size={13} className="node-summary-edit" aria-hidden="true" />}
        </span>
        {previewText && previewText !== name && <span className="node-summary-text" title={previewText} data-node-preview>{previewText}</span>}
      </button>
    </div>
  );

  if (isViewerMode && !open) return null;
  return (
    <div ref={editorRef} onBlur={dismiss.onBlur} className={`node-metadata node-metadata--${variant}${open ? ' node-metadata--editing' : ''} nodrag nopan`}
      data-node-metadata data-node-metadata-editor={open || undefined}>
      <button ref={triggerRef} type="button" onClick={() => open ? close() : begin()} disabled={!open && data.isLoading}
        className="node-metadata-toggle"
        aria-expanded={open} aria-controls={editorId} data-node-metadata-toggle>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{t('node.metadata')}</span>
        {!open && hasDraft && <span>{t('node.metadataDraft')}</span>}
      </button>
      {open && <div id={editorId} className="node-metadata-fields"
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !isImeComposing(event)) {
            event.preventDefault(); save();
          }
        }}>
        <label className="node-metadata-field">
          {t('node.metadataTitle')}
          <input value={title} onChange={event => writeTitle(event.target.value)} autoFocus data-node-title-input
            placeholder={t('node.metadataTitlePlaceholder')} />
        </label>
        <label className="node-metadata-field">
          {t('node.metadataSummary')}
          <textarea value={summary} onChange={event => writeSummary(event.target.value)} rows={3} data-node-summary-input
            placeholder={t('node.metadataSummaryPlaceholder')}
            className="nowheel" />
        </label>
        {error && <p role="alert" className="node-metadata-error">{error}</p>}
        <div className="node-metadata-actions">
          <button type="button" onClick={() => void generate()} disabled={busy || data.isLoading || !(data.question.trim() || data.response.trim())}
            data-node-metadata-generate className="node-metadata-action">
            {busy ? <LoaderCircle size={14} className="animate-spin" /> : <WandSparkles size={14} />}
            {t(busy ? 'node.metadataGenerating' : 'node.metadataGenerate')}
          </button>
          <div>
            <button type="button" onClick={() => close(true)} data-node-metadata-cancel className="node-metadata-action">{t('common.cancel')}</button>
            <button type="button" onClick={save} disabled={data.isLoading} data-node-metadata-save className="node-metadata-action node-metadata-save">{t('common.save')}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}
