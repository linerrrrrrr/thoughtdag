import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { SuperDoc } from 'superdoc';
import type { CommandId, SelectionCapture } from 'superdoc/ui';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronDown, Columns3,
  Download, Eraser, Highlighter, ImagePlus, IndentDecrease, IndentIncrease, Italic,
  Link2, List, ListOrdered, Loader2, Merge, Minus, Plus, Redo2, Rows3, Save, Split,
  Strikethrough, Table2, Trash2, Type, Underline, Undo2, X, type LucideIcon,
} from 'lucide-react';
import { useT, type MessageKey } from '../i18n';
import { toast } from '../lib/ui-store';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import type { createDocxViewport } from '../lib/docx-viewport';
import './SuperDocToolbar.css';

type Props = {
  instance: SuperDoc;
  viewport: ReturnType<typeof createDocxViewport>;
  name: string;
  dirty: boolean;
  saving: boolean;
  canSave?: boolean;
  onSave: () => void;
  onExport: () => void;
  onHide: () => void;
};

const TOGGLE_COMMANDS = new Set(['bold', 'italic', 'underline', 'strikethrough', 'bullet-list', 'numbered-list']);

function useSnapshot<T,>(handle: { observe: (listener: (value: T) => void) => () => void; getSnapshot: () => T }): T {
  return useSyncExternalStore(
    useCallback(listener => handle.observe(() => listener()), [handle]),
    useCallback(() => handle.getSnapshot(), [handle]),
  );
}

function asHex(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const hex = value.startsWith('#') ? value : `#${value}`;
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback;
}

function scalar(value: unknown): string {
  return typeof value === 'number' || typeof value === 'string' ? String(value) : '';
}

/** One application-owned toolbar follows the active document without recreating its editor. */
export default function SuperDocToolbar({ instance, viewport, name, dirty, saving, canSave = true, onSave, onExport, onHide }: Props) {
  const t = useT();
  const ui = instance.ui;
  const snapshot = useSnapshot(ui.toolbar);
  const fonts = useSnapshot(ui.fonts);
  const zoom = useSyncExternalStore(viewport.subscribe, viewport.getSnapshot);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The full canvas node or reader workspace and its toolbar form one boundary.
  const editorRootRef = useMemo(() => ({
    get current() {
      const element = instance.element instanceof HTMLElement ? instance.element : null;
      return element?.closest<HTMLElement>('.react-flow__node')
        ?? element?.closest<HTMLElement>('[data-superdoc-editor]') ?? element;
    },
  }), [instance]);
  const fileRef = useRef<HTMLInputElement>(null);
  const selection = useRef<{ instance: SuperDoc; capture: SelectionCapture | null } | null>(null);
  const [panel, setPanel] = useState<'table' | 'link' | null>(null);
  const [rows, setRows] = useState('3');
  const [columns, setColumns] = useState('3');
  const [url, setUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  useDismissableLayer({
    open: true, refs: [toolbarRef, editorRootRef],
    // Other non-modal canvas panels must not shield this document from outside clicks.
    independentOutside: !(instance.element instanceof HTMLElement && instance.element.closest('[aria-modal="true"]')),
    onDismiss: reason => {
      if (reason === 'outside' && instance.element instanceof HTMLElement
        && document.activeElement instanceof HTMLElement && instance.element.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      onHide();
    },
    restoreFocus: false,
  });
  useDismissableLayer({
    open: panel !== null, refs: [panelRef],
    onDismiss: () => setPanel(null), restoreFocus: false,
    ignoreOutside: event => event.target instanceof Element
      && !!event.target.closest(`[data-docx-panel-trigger="${panel}"]`),
  });

  const capture = () => {
    // Subsequent clicks within the toolbar must not replace the saved document range.
    if (toolbarRef.current?.contains(document.activeElement) && selection.current?.instance === instance) return;
    selection.current = { instance, capture: ui.selection.capture() };
  };
  const restore = (target = instance) => {
    target.focus({ preventScroll: true, restoreSelection: true });
    const saved = selection.current;
    if (saved?.instance === target && saved.capture) target.ui.selection.restore(saved.capture);
  };
  const run = async (id: CommandId, payload?: unknown, target = instance) => {
    try {
      if (!toolbarRef.current?.isConnected) return false;
      restore(target);
      const result = await target.ui.commands.executeAsync(id, payload);
      if (result === false || (typeof result === 'object' && !result.success)) {
        toast('error', t('nativeDocument.commandFailed'));
        return false;
      }
      // An insertion panel may unmount next; keep typing in the initiating document.
      if (toolbarRef.current?.isConnected) target.focus({ preventScroll: true, restoreSelection: true });
      return true;
    } catch {
      toast('error', t('nativeDocument.commandFailed'));
      return false;
    }
  };
  const available = (id: CommandId) => !saving && !!snapshot.commands[id]?.enabled;
  const active = (id: CommandId) => !!snapshot.commands[id]?.active;
  const value = (id: CommandId) => snapshot.commands[id]?.value;
  const tool = (id: CommandId, label: MessageKey, Icon: LucideIcon, payload?: unknown, pressed?: boolean) =>
    <button key={`${id}:${String(payload ?? '')}`} type="button" className="native-document-tool"
      aria-label={t(label)} data-tooltip={t(label)} data-docx-command={id}
      aria-pressed={pressed ?? (TOGGLE_COMMANDS.has(id) ? active(id) : undefined)} disabled={!available(id)}
      onPointerDown={event => event.preventDefault()} onClick={() => { void run(id, payload); }}>
      <Icon size={16} strokeWidth={1.75} />
    </button>;

  const font = scalar(value('font-family'));
  const size = scalar(value('font-size')).replace(/pt$/i, '');
  const sizes = [...new Set([...fonts.sizeOptions.map(option => option.value.replace(/pt$/i, '')), ...(size ? [size] : [])])];
  const familyOptions = fonts.options.some(option => option.value === font) || !font
    ? fonts.options : [{ value: font, label: font }, ...fonts.options];
  const alignment = scalar(value('text-align'));
  const inTable = ['table-add-row-after', 'table-add-column-after', 'table-delete'].some(id => available(id));
  const validTable = /^\d+$/.test(rows) && /^\d+$/.test(columns)
    && Number(rows) > 0 && Number(rows) <= 50 && Number(columns) > 0 && Number(columns) <= 20;
  const validLink = /^(https?:\/\/|mailto:|tel:|#)/i.test(url.trim());

  const insertImage = async (file: File) => {
    const target = instance;
    const saved = selection.current;
    setUploading(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      // Preserve the initiating document and range while the local file picker owns focus.
      selection.current = saved;
      const ok = await run('image', { src: data, alt: file.name }, target);
      if (ok) setPanel(null);
    } catch { toast('error', t('richDocument.imageFailed')); }
    finally { setUploading(false); }
  };

  return <div ref={toolbarRef} className="native-document-toolbar nodrag nopan nowheel" data-docx-toolbar
    role="region" aria-label={t('nativeDocument.toolbar')} onPointerDownCapture={capture}
    onFocusCapture={event => {
      if (!(event.relatedTarget instanceof Node) || !toolbarRef.current?.contains(event.relatedTarget)) {
        selection.current = { instance, capture: ui.selection.capture() };
      }
    }}
    onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => {
      // The shared layer stack owns Escape and modal Tab, including portal children.
      if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
    }}>
    <div className="native-document-toolbar-header">
      <div className="native-document-toolbar-name" data-tooltip={name} data-tooltip-overflow>{name}</div>
      <span className="native-document-toolbar-status" data-dirty={dirty} role="status">
        {t(saving ? 'richDocument.saving' : dirty ? 'document.pendingWrite' : 'nativeDocument.saved')}
      </span>
      <div className="native-document-toolbar-actions">
        <button type="button" className="native-document-text-action" disabled={saving || uploading}
          onClick={onExport} data-docx-export><Download size={15} />{t('richDocument.exportDocx')}</button>
        <button type="button" className="native-document-text-action native-document-save" disabled={!dirty || !canSave || saving || uploading}
          onClick={onSave} data-docx-save data-tooltip={t('document.saveOriginal')}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {t(saving ? 'richDocument.saving' : 'common.save')}
        </button>
        <button type="button" className="native-document-tool" onClick={onHide}
          aria-label={t('nativeDocument.hideTools')} data-tooltip={t('nativeDocument.hideTools')}><X size={16} /></button>
      </div>
    </div>
    <div className="native-document-toolbar-controls">
      <div className="native-document-tool-group">
        {tool('undo', 'richDocument.undo', Undo2)}{tool('redo', 'richDocument.redo', Redo2)}
      </div>
      <div className="native-document-tool-group">
        <select className="native-document-select native-document-font" aria-label={t('richDocument.font')}
          value={font} disabled={!available('font-family')} onFocus={capture}
          onChange={event => { void run('font-family', event.target.value); }} data-docx-font>
          {!font && <option value="">{t('richDocument.font')}</option>}
          {familyOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select className="native-document-select native-document-size" aria-label={t('richDocument.fontSize')}
          value={size} disabled={!available('font-size')} onFocus={capture}
          onChange={event => { void run('font-size', Number(event.target.value)); }} data-docx-size>
          {!size && <option value="">{t('richDocument.fontSize')}</option>}
          {sizes.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
        {tool('bold', 'richDocument.bold', Bold)}{tool('italic', 'richDocument.italic', Italic)}
        {tool('underline', 'richDocument.underline', Underline)}{tool('strikethrough', 'richDocument.strike', Strikethrough)}
        <label className="native-document-tool native-document-color" data-tooltip={t('richDocument.color')}>
          <Type size={16} strokeWidth={1.75} />
          <span style={{ background: asHex(value('text-color'), '#202632') }} />
          <input type="color" aria-label={t('richDocument.color')} value={asHex(value('text-color'), '#202632')}
            disabled={!available('text-color')} onFocus={capture} onChange={event => { void run('text-color', event.target.value); }} />
        </label>
        <label className="native-document-tool native-document-color" data-tooltip={t('richDocument.highlight')}>
          <Highlighter size={16} strokeWidth={1.75} />
          <span style={{ background: asHex(value('highlight-color'), '#fff19a') }} />
          <input type="color" aria-label={t('richDocument.highlight')} value={asHex(value('highlight-color'), '#fff19a')}
            disabled={!available('highlight-color')} onFocus={capture} onChange={event => { void run('highlight-color', event.target.value); }} />
        </label>
        {tool('clear-formatting', 'richDocument.clearFormat', Eraser)}
      </div>
      <div className="native-document-tool-group">
        {tool('text-align', 'richDocument.alignLeft', AlignLeft, 'left', alignment === 'left')}
        {tool('text-align', 'richDocument.alignCenter', AlignCenter, 'center', alignment === 'center')}
        {tool('text-align', 'richDocument.alignRight', AlignRight, 'right', alignment === 'right')}
        {tool('text-align', 'richDocument.alignJustify', AlignJustify, 'justify', alignment === 'justify')}
        {tool('bullet-list', 'richDocument.bulletList', List)}{tool('numbered-list', 'richDocument.numberedList', ListOrdered)}
        {tool('indent-decrease', 'richDocument.outdent', IndentDecrease)}{tool('indent-increase', 'richDocument.indent', IndentIncrease)}
      </div>
      <div className="native-document-tool-group">
        <button type="button" className="native-document-tool" disabled={!available('link')}
          aria-label={t('richDocument.link')} data-tooltip={t('richDocument.link')} aria-expanded={panel === 'link'}
          data-docx-panel-trigger="link"
          onPointerDown={event => event.preventDefault()} onClick={() => setPanel(panel === 'link' ? null : 'link')}><Link2 size={16} /></button>
        <button type="button" className="native-document-tool" disabled={uploading || !available('image')}
          aria-label={t('richDocument.insertImage')} data-tooltip={t('richDocument.insertImage')} data-docx-insert-image
          onPointerDown={event => event.preventDefault()} onClick={() => fileRef.current?.click()}>
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
        </button>
        <input type="file" ref={fileRef} className="native-document-file" accept="image/png,image/jpeg,image/gif,image/webp"
          tabIndex={-1} aria-hidden onChange={event => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (file) void insertImage(file);
          }} />
        <button type="button" className="native-document-tool native-document-insert-table" disabled={!available('table-insert')}
          aria-label={t('richDocument.insertTable')} data-tooltip={t('richDocument.insertTable')} data-docx-insert-table
          data-docx-panel-trigger="table"
          aria-expanded={panel === 'table'} onPointerDown={event => event.preventDefault()}
          onClick={() => setPanel(panel === 'table' ? null : 'table')}><Table2 size={16} /><ChevronDown size={10} /></button>
        <select className="native-document-select native-document-zoom" aria-label={t('nativeDocument.fitWidth')}
          value={zoom.mode === 'fit-width' ? 'fit' : String(Math.round(zoom.value))}
          onChange={event => {
            viewport.setZoom(event.target.value === 'fit' ? 'fit-width' : Number(event.target.value));
          }}>
          <option value="fit">{t('nativeDocument.fitWidth')}</option>
          {[...new Set([50, 75, 100, 125, 150, 200, Math.round(zoom.value)])].filter(n => n > 0).sort((a, b) => a - b)
            .map(n => <option key={n} value={n}>{n}%</option>)}
        </select>
      </div>
    </div>
    {inTable && <div className="native-document-table-tools">
      <Rows3 size={15} aria-hidden />
      {tool('table-add-row-after', 'richDocument.addRow', Plus)}{tool('table-delete-row', 'richDocument.deleteRow', Minus)}
      <Columns3 size={15} aria-hidden />
      {tool('table-add-column-after', 'richDocument.addColumn', Plus)}{tool('table-delete-column', 'richDocument.deleteColumn', Minus)}
      {tool('table-merge-cells', 'richDocument.mergeCells', Merge)}{tool('table-split-cell', 'richDocument.splitCell', Split)}
      {tool('table-delete', 'richDocument.deleteTable', Trash2)}
    </div>}
    {panel && <div ref={panelRef} className="native-document-command-panel" data-docx-command-panel={panel}>
      {panel === 'table' ? <>
        <label>{t('nativeDocument.tableRows')}<input type="number" min={1} max={50} value={rows}
          onChange={event => setRows(event.target.value)} className="native-document-select" /></label>
        <label>{t('nativeDocument.tableColumns')}<input type="number" min={1} max={20} value={columns}
          onChange={event => setColumns(event.target.value)} className="native-document-select" /></label>
        <button type="button" className="native-document-text-action native-document-save" disabled={!validTable || saving}
          onClick={() => { void run('table-insert', { rows: Number(rows), columns: Number(columns) }).then(ok => { if (ok) setPanel(null); }); }}
          data-docx-confirm-table>{t('richDocument.insertTable')}</button>
      </> : <>
        <input type="url" className="native-document-select native-document-url" value={url} onChange={event => setUrl(event.target.value)}
          aria-label={t('richDocument.url')} placeholder="https://" />
        <button type="button" className="native-document-text-action native-document-save" disabled={!validLink || saving}
          onClick={() => { void run('link', { href: url.trim() }).then(ok => { if (ok) setPanel(null); }); }}>{t('richDocument.applyLink')}</button>
      </>}
      <button type="button" className="native-document-text-action" onClick={() => setPanel(null)}>{t('common.cancel')}</button>
    </div>}
  </div>;
}
