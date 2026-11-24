import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Columns3, FileDown,
  Highlighter, ImagePlus, IndentDecrease, IndentIncrease, Italic, Link2, List,
  ListOrdered, Loader2, Merge, Minus, Plus, Redo2, Rows3, Split, Strikethrough,
  Table2, Trash2, Type, Underline, Undo2, Unlink, Eraser, type LucideIcon,
} from 'lucide-react';
import type { Attachment } from '../types';
import { useStore } from '../store';
import { useProjects } from '../store/projects';
import { useUiStore, toast } from '../lib/ui-store';
import { useSessionDraft } from '../lib/use-session-draft';
import { useInlineEditDismiss } from '../lib/use-inline-edit-dismiss';
import { documentRichHtml, isDocxDocument } from '../lib/document-copy';
import { documentHtmlToMarkdown } from '../lib/html-material';
import { exportDocumentDocx } from '../lib/docx-export';
import { richDocumentDraftKey } from '../lib/rich-document-draft';
import { richTextHighlights } from '../lib/document-highlights';
import { richDocumentExtensions, changeParagraphIndent } from '../lib/rich-document-extensions';
import { isViewerMode } from '../lib/viewer';
import { isImeComposing } from '../utils';
import { useT } from '../i18n';
import './RichDocumentEditor.css';

type Props = { nodeId: string; attachment: Attachment; onClose: () => void; compact?: boolean };

function Tool({ icon: Icon, label, action, active, disabled, name }: {
  icon: LucideIcon; label: string; action: () => void; active?: boolean; disabled?: boolean; name: string;
}) {
  return <button type="button" className="rich-document-tool" aria-label={label} data-tooltip={label}
    aria-pressed={active} disabled={disabled} data-rich-action={name}
    onPointerDown={event => event.preventDefault()} onClick={action}>
    <Icon size={16} strokeWidth={1.75} />
  </button>;
}

/** Selecting a local image never uploads it; unsupported export formats become PNG. */
async function imageFile(file: File): Promise<{ src: string; width: number; height: number }> {
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = src;
  await image.decode();
  const width = Math.min(640, image.naturalWidth);
  const height = Math.max(1, Math.round(image.naturalHeight * width / image.naturalWidth));
  if (/^image\/(png|jpeg|gif)$/.test(file.type)) return { src, width, height };
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image conversion is unavailable');
  context.drawImage(image, 0, 0);
  return { src: canvas.toDataURL('image/png'), width, height };
}

function LinkEditor({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState(String(editor.getAttributes('link').href ?? ''));
  const isToggle = (target: EventTarget | null) => target instanceof Element && !!target.closest('[data-rich-action="link"]');
  const boundary = useInlineEditDismiss({ active: true, ref, onOutside: onClose, onCancel: onClose,
    ignoreOutside: event => isToggle(event.target), ignoreFocusOutside: isToggle });
  const apply = () => {
    const value = url.trim();
    if (value && !/^(https?:\/\/|mailto:|tel:|#)/i.test(value)) return;
    const insert = editor.state.selection.empty && !editor.isActive('link');
    const chain = editor.chain().focus().extendMarkRange('link');
    if (value && insert) chain.insertContent({ type: 'text', text: value, marks: [{ type: 'link', attrs: { href: value } }] }).run();
    else if (value) chain.setLink({ href: value }).run();
    else chain.unsetLink().run();
    onClose();
  };
  return <div ref={ref} onBlur={boundary.onBlur} className="flex flex-wrap items-center gap-2" data-rich-link-editor
    onKeyDown={event => {
      if (isImeComposing(event)) return;
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); apply(); }
    }}>
    <input type="url" value={url} autoFocus onChange={event => setUrl(event.target.value)} aria-label={t('richDocument.url')}
      placeholder="https://" className="min-w-0 flex-1 text-control bg-card text-ink border border-line rounded-control px-3 py-1.5" />
    <button type="button" onClick={apply} disabled={!!url.trim() && !/^(https?:\/\/|mailto:|tel:|#)/i.test(url.trim())}
      className="px-3 py-1.5 text-control bg-action text-white rounded-control disabled:opacity-40">{t('richDocument.applyLink')}</button>
    <Tool icon={Unlink} label={t('richDocument.removeLink')} name="remove-link" action={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); onClose(); }} />
    <button type="button" onClick={onClose} className="px-3 py-1.5 text-control text-ink-muted hover:bg-wash rounded-control">{t('common.cancel')}</button>
  </div>;
}

function RichDocumentBody({ nodeId, attachment, onClose, compact = false, initialHtml, draftKey }: Props & { initialHtml: string; draftKey: string }) {
  const t = useT();
  const [draft, setDraft] = useSessionDraft(draftKey, initialHtml);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const boundaryRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const savingRef = useRef(false);
  const initial = useRef(draft);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const insertFiles = async (files: File[], editor: Editor) => {
    for (const file of files.filter(file => file.type.startsWith('image/'))) {
      try {
        const image = await imageFile(file);
        if (!alive.current || editor.isDestroyed) return;
        editor.chain().focus().setImage({ ...image, alt: file.name }).run();
      } catch { if (alive.current) toast('error', t('richDocument.imageFailed')); }
    }
  };
  const editor = useEditor({
    extensions: richDocumentExtensions(),
    content: initial.current,
    autofocus: 'start',
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { 'aria-label': t('document.body'), 'data-rich-content': '', class: 'text-body' },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        if (editor) void insertFiles(files, editor);
        return true;
      },
      handleDrop: (_view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files ?? [])].filter(file => file.type.startsWith('image/'));
        if (moved || !files.length) return false;
        event.preventDefault();
        event.stopPropagation();
        if (editor) void insertFiles(files, editor);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => setDraft(current.getHTML()),
  });
  useEditorState({ editor, selector: state => state.transactionNumber });

  // The open editor owns its transactions. Replaying its cached HTML after a
  // toolbar focus change would overwrite local undo/redo; another surface
  // picks up that shared draft when it opens instead.
  useEffect(() => { editor?.setEditable(!saving); }, [editor, saving]);
  const cancel = () => {
    if (savingRef.current) return;
    useUiStore.getState().setDraft(draftKey, '');
    onClose();
  };
  const ignoreOutside = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    if (target.closest('.react-flow__resize-control, .react-flow__controls')) return true;
    const attribute = compact ? 'data-document-edit' : 'data-reader-edit-toggle';
    return target.closest(`[${attribute}]`)?.getAttribute(attribute) === attachment.id;
  };
  const dismiss = useInlineEditDismiss({
    active: true, ref: boundaryRef, onOutside: onClose, onCancel: cancel,
    ignoreOutside: event => ignoreOutside(event.target), ignoreFocusOutside: ignoreOutside,
  });
  const save = async () => {
    if (!editor || editor.isDestroyed || savingRef.current || isViewerMode || !isDocxDocument(attachment)) return;
    savingRef.current = true;
    setSaving(true);
    const html = editor.getHTML();
    // Cache the latest DOM before async conversion, including an empty document.
    setDraft(html);
    try {
      const text = await documentHtmlToMarkdown(html);
      if (!alive.current) return;
      const state = useStore.getState();
      const current = state.nodes.find(node => node.id === nodeId)?.data.attachments?.find(att => att.id === attachment.id);
      if (!current || !isDocxDocument(current)) return;
      if (html !== current.editedHtml || text !== current.editedText) {
        state.pushHistory();
        state.setAttachmentData(nodeId, attachment.id, { editedHtml: html, editedText: text,
          documentHighlights: richTextHighlights(html, current.documentHighlights) });
        state.pushHistory();
      }
      useUiStore.getState().setDraft(draftKey, '');
      onClose();
    } catch { if (alive.current) toast('error', t('richDocument.saveFailed')); }
    finally { savingRef.current = false; if (alive.current) setSaving(false); }
  };
  const exportDocx = async () => {
    if (!editor || exporting) return;
    setExporting(true);
    try { await exportDocumentDocx(editor.getHTML(), attachment.name); }
    catch { toast('error', t('richDocument.exportFailed')); }
    finally { if (alive.current) setExporting(false); }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isImeComposing(event) || editor?.view.composing) return;
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation(); void save();
    }
  };

  if (!editor) return <p className="text-control text-ink-muted">{t('richDocument.loading')}</p>;
  const textStyle = editor.getAttributes('textStyle');
  const activeHeading = [1, 2, 3].find(level => editor.isActive('heading', { level })) ?? 0;
  const family = String(textStyle.fontFamily ?? '');
  const size = String(textStyle.fontSize ?? '');
  const imageAttributes = editor.getAttributes('image');
  const table = editor.isActive('table');
  const imageSelected = editor.isActive('image');
  const inList = editor.isActive('listItem');
  const indent = Number(editor.getAttributes(activeHeading ? 'heading' : 'paragraph').indent ?? 0);
  const fonts = [['', t('richDocument.defaultFont')], ['sans-serif', t('richDocument.sans')], ['serif', t('richDocument.serif')], ['monospace', t('richDocument.mono')], ['SimSun', t('richDocument.song')], ['SimHei', t('richDocument.hei')]];
  const sizes = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48].map(value => `${value}pt`);
  const imageWidths = [...new Set([160, 240, 320, 480, 640, 800, 960, ...(imageAttributes.width ? [Number(imageAttributes.width)] : [])])].sort((a, b) => a - b);
  const asHex = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

  return <div ref={boundaryRef} onBlur={dismiss.onBlur} onKeyDown={onKeyDown}
    onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    className="rich-document-editor space-y-3 nodrag nopan nowheel" data-rich-document-editor={attachment.id} data-compact={compact}>
    <fieldset disabled={saving} className="rich-document-toolbar text-control" aria-label={t('richDocument.style')}>
      <div className="rich-document-toolbar-group">
        <select value={activeHeading} className="rich-document-select max-w-[140px]" aria-label={t('richDocument.style')} data-rich-style
          onChange={event => { const level = Number(event.target.value); if (level === 0) editor.chain().focus().setParagraph().run(); else editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 }).run(); }}>
          <option value={0}>{t('richDocument.paragraph')}</option><option value={1}>{t('richDocument.heading1')}</option><option value={2}>{t('richDocument.heading2')}</option><option value={3}>{t('richDocument.heading3')}</option>
        </select>
        <select value={family} className="rich-document-select max-w-[144px]" aria-label={t('richDocument.font')} data-rich-font
          onChange={event => { if (event.target.value) editor.chain().focus().setFontFamily(event.target.value).run(); else editor.chain().focus().unsetFontFamily().run(); }}>
          {!fonts.some(([value]) => value === family) && <option value={family}>{family}</option>}
          {fonts.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={size} className="rich-document-select max-w-[88px]" aria-label={t('richDocument.fontSize')} data-rich-size
          onChange={event => { if (event.target.value) editor.chain().focus().setFontSize(event.target.value).run(); else editor.chain().focus().unsetFontSize().run(); }}>
          <option value="">{t('richDocument.fontSize')}</option>
          {!!size && !sizes.includes(size) && <option value={size}>{size}</option>}
          {sizes.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      <div className="rich-document-toolbar-group">
        <Tool icon={Bold} name="bold" label={t('richDocument.bold')} active={editor.isActive('bold')} action={() => editor.chain().focus().toggleBold().run()} />
        <Tool icon={Italic} name="italic" label={t('richDocument.italic')} active={editor.isActive('italic')} action={() => editor.chain().focus().toggleItalic().run()} />
        <Tool icon={Underline} name="underline" label={t('richDocument.underline')} active={editor.isActive('underline')} action={() => editor.chain().focus().toggleUnderline().run()} />
        <Tool icon={Strikethrough} name="strike" label={t('richDocument.strike')} active={editor.isActive('strike')} action={() => editor.chain().focus().toggleStrike().run()} />
        <label className="rich-document-tool rich-document-color" data-tooltip={t('richDocument.color')}>
          <Type size={16} strokeWidth={1.75} style={{ color: textStyle.color }} />
          <input type="color" value={asHex(textStyle.color, '#202632')} aria-label={t('richDocument.color')} data-rich-color onChange={event => editor.chain().focus().setColor(event.target.value).run()} />
        </label>
        <label className="rich-document-tool rich-document-color" data-tooltip={t('richDocument.highlight')}>
          <Highlighter size={16} strokeWidth={1.75} />
          <input type="color" value={asHex(textStyle.backgroundColor, '#fff19a')} aria-label={t('richDocument.highlight')} data-rich-highlight onChange={event => editor.chain().focus().setBackgroundColor(event.target.value).run()} />
        </label>
        <Tool icon={Eraser} name="clear-format" label={t('richDocument.clearFormat')} action={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} />
      </div>
      <div className="rich-document-toolbar-group">
        <Tool icon={AlignLeft} name="align-left" label={t('richDocument.alignLeft')} active={editor.isActive({ textAlign: 'left' })} action={() => editor.chain().focus().setTextAlign('left').run()} />
        <Tool icon={AlignCenter} name="align-center" label={t('richDocument.alignCenter')} active={editor.isActive({ textAlign: 'center' })} action={() => editor.chain().focus().setTextAlign('center').run()} />
        <Tool icon={AlignRight} name="align-right" label={t('richDocument.alignRight')} active={editor.isActive({ textAlign: 'right' })} action={() => editor.chain().focus().setTextAlign('right').run()} />
        <Tool icon={AlignJustify} name="align-justify" label={t('richDocument.alignJustify')} active={editor.isActive({ textAlign: 'justify' })} action={() => editor.chain().focus().setTextAlign('justify').run()} />
        <Tool icon={List} name="bullet-list" label={t('richDocument.bulletList')} active={editor.isActive('bulletList')} action={() => editor.chain().focus().toggleBulletList().run()} />
        <Tool icon={ListOrdered} name="numbered-list" label={t('richDocument.numberedList')} active={editor.isActive('orderedList')} action={() => editor.chain().focus().toggleOrderedList().run()} />
        <Tool icon={IndentIncrease} name="indent" label={t('richDocument.indent')} disabled={inList ? !editor.can().sinkListItem('listItem') : imageSelected || indent >= 8}
          action={() => { if (inList) editor.chain().focus().sinkListItem('listItem').run(); else changeParagraphIndent(editor, 1); }} />
        <Tool icon={IndentDecrease} name="outdent" label={t('richDocument.outdent')} disabled={inList ? !editor.can().liftListItem('listItem') : imageSelected || indent <= 0}
          action={() => { if (inList) editor.chain().focus().liftListItem('listItem').run(); else changeParagraphIndent(editor, -1); }} />
      </div>
      <div className="rich-document-toolbar-group">
        <Tool icon={Link2} name="link" label={t('richDocument.link')} active={editor.isActive('link') || linkOpen} action={() => setLinkOpen(value => !value)} />
        <Tool icon={ImagePlus} name="insert-image" label={t('richDocument.insertImage')} action={() => fileInput.current?.click()} />
        <Tool icon={Table2} name="insert-table" label={t('richDocument.insertTable')} action={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
        <Tool icon={Undo2} name="undo" label={t('richDocument.undo')} disabled={!editor.can().undo()} action={() => editor.chain().focus().undo().run()} />
        <Tool icon={Redo2} name="redo" label={t('richDocument.redo')} disabled={!editor.can().redo()} action={() => editor.chain().focus().redo().run()} />
      </div>
    </fieldset>
    {linkOpen && <LinkEditor editor={editor} onClose={() => setLinkOpen(false)} />}
    {table && <div className="flex flex-wrap items-center gap-1 text-control" data-rich-table-tools>
      <Rows3 size={15} className="text-ink-faint mx-1" />
      <Tool icon={Plus} name="add-row" label={t('richDocument.addRow')} action={() => editor.chain().focus().addRowAfter().run()} />
      <Tool icon={Minus} name="delete-row" label={t('richDocument.deleteRow')} action={() => editor.chain().focus().deleteRow().run()} />
      <Columns3 size={15} className="text-ink-faint ml-3 mr-1" />
      <Tool icon={Plus} name="add-column" label={t('richDocument.addColumn')} action={() => editor.chain().focus().addColumnAfter().run()} />
      <Tool icon={Minus} name="delete-column" label={t('richDocument.deleteColumn')} action={() => editor.chain().focus().deleteColumn().run()} />
      <Tool icon={Merge} name="merge-cells" label={t('richDocument.mergeCells')} disabled={!editor.can().mergeCells()} action={() => editor.chain().focus().mergeCells().run()} />
      <Tool icon={Split} name="split-cell" label={t('richDocument.splitCell')} disabled={!editor.can().splitCell()} action={() => editor.chain().focus().splitCell().run()} />
      <Tool icon={Trash2} name="delete-table" label={t('richDocument.deleteTable')} action={() => editor.chain().focus().deleteTable().run()} />
    </div>}
    {imageSelected && <label className="flex items-center gap-2 text-control text-ink-muted" data-rich-image-tools>
      {t('richDocument.imageWidth')}
      <select value={imageAttributes.width ?? ''}
        aria-label={t('richDocument.imageWidth')} className="rich-document-select w-24"
        onChange={event => {
          const width = Number(event.target.value);
          if (!Number.isFinite(width) || width < 40 || width > 2400) return;
          const ratio = Number(imageAttributes.height) / Number(imageAttributes.width);
          editor.chain().focus().updateAttributes('image', { width, ...(Number.isFinite(ratio) ? { height: Math.round(width * ratio) } : {}) }).run();
        }}>
        {!imageAttributes.width && <option value="">—</option>}
        {imageWidths.map(width => <option key={width} value={width}>{width}</option>)}
      </select>
      <span className="text-meta">px</span>
    </label>}
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden data-rich-image-input
      onChange={event => { const files = [...(event.target.files ?? [])]; event.target.value = ''; void insertFiles(files, editor); }} />
    <EditorContent editor={editor} data-type-surface="native-document" className="rich-document-surface text-body" />
    <div className="flex items-center gap-2 flex-wrap">
      <button type="button" onClick={() => void exportDocx()} disabled={exporting || saving}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-control text-control text-ink-muted hover:bg-wash disabled:opacity-40" data-rich-export>
        {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} strokeWidth={1.75} />}
        {t(exporting ? 'richDocument.exporting' : 'richDocument.exportDocx')}
      </button>
      <div className="flex-1" />
      <button type="button" disabled={saving} onClick={cancel} className="px-3 py-1.5 text-control text-ink-muted hover:bg-wash rounded-control disabled:opacity-40">{t('common.cancel')}</button>
      <button type="button" disabled={saving} onClick={() => void save()} data-rich-save className="px-3 py-1.5 text-control text-white bg-action hover:bg-action-strong rounded-control disabled:opacity-40">{t(saving ? 'richDocument.saving' : 'common.save')}</button>
    </div>
    <p className="text-control text-ink-faint">{t('richDocument.hint')}</p>
  </div>;
}

export default function RichDocumentEditor(props: Props) {
  const t = useT();
  const projectId = useProjects(state => state.activeId);
  const draftKey = richDocumentDraftKey(projectId, props.nodeId, props.attachment.id);
  const [loaded, setLoaded] = useState<{ key: string; html: string } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const cached = useUiStore.getState().drafts[draftKey];
    const value = cached !== undefined ? Promise.resolve(cached) : documentRichHtml(props.attachment);
    void value.then(html => { if (!cancelled) setLoaded({ key: draftKey, html }); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
    // This is the opening snapshot; subsequent edits stay in the session draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  if (isViewerMode || !isDocxDocument(props.attachment)) return null;
  if (error) return <p className="text-control text-red-600">{t('richDocument.loadFailed')}</p>;
  if (!loaded || loaded.key !== draftKey) return <p className="flex items-center gap-2 text-control text-ink-muted"><Loader2 size={15} className="animate-spin" />{t('richDocument.loading')}</p>;
  return <RichDocumentBody key={draftKey} {...props} initialHtml={loaded.html} draftKey={draftKey} />;
}
