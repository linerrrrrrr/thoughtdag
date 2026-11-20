import { t } from '../i18n';

// Subtract from a detached copy of the editor. This list is shared by the
// mounted canvas, offscreen nodes, already-open windows and reader templates.
export const readonlyOmissions = {
  workspace: '[data-content-palette], [data-model-picker-trigger], [data-model-picker-panel], [data-project-menu], [data-settings-entry], [data-toolbar-more], [data-toolbar-more-panel], [data-chat-entry], [data-search-entry], [data-canvas-search], [data-layout-entry], [data-canvas-layout-panel], [data-canvas-detail-trigger], [data-canvas-detail-panel], [data-selection-target-control], [data-selection-toolbar], .canvas-toolbar-context, [data-settings-section]',
  geometry: '.react-flow__resize-control, .react-flow__controls-interactive, [data-frame-carry-toggle], [data-panel-resize], [data-reader-resize], [data-edge-inspector]',
  edit: '[data-export-omit], .object-action-danger, [data-edit-question], [data-edit-response], [data-note-edit], [data-resume-note-draft], .node-metadata-actions, [data-edit-toggles], [data-edit-submit], [data-edit-cancel], [data-highlighter-toggle], [data-reader-clip-toggle], [data-clip-overlay], [data-attachment-remove], .question-attach-button, .material-upload',
  execution: '.node-ask-actions, [data-question-send], [data-ask-submit], [data-ask-toggles], [data-agent-instruction], [data-agent-session-pin], [data-agent-stop], [data-open-in-terminal], [data-reader-askbar], [data-web-toggle], [data-scholar-toggle], [data-image-recognize], [data-chat-suggestions], [data-chat-input], [data-chat-send]',
  files: '[data-document-original], [data-superdoc-toolbar], [data-docx-reader-toolbar], [data-superdoc-save], [data-superdoc-export], [data-pdf-mode], [data-pdf-save], [data-pdf-delete-annotation], [data-pdf-region-layer], [data-v2-ime-host]',
} as const;

// These controls use the original markup and have a local reading action.
const navigation = [
  '.react-flow__controls-zoomin', '.react-flow__controls-zoomout', '.react-flow__controls-fitview', '.react-flow__controls-pan',
  '[data-frame-nav-trigger]', '[data-frame-nav-id]', '[data-node-details]', '[data-node-details-close]',
  '[data-open-export-reader]', '[data-document-open]', '[data-overview-ruler-mark]', '[data-material-reader-close]',
  '[data-reader-expand]', '[data-reader-dock]', '[data-reader-strip-expand]', '[data-image-zoom] button',
  '[data-pdf-annotation]', '[data-pdf-comment-pin]', '[data-highlight-disclosure]',
].join(',');

// Some editor buttons also carry graph data. Keep their original content
// and classes as labels when removing their command.
const labels = [
  '.canvas-project-button', '[data-edge-annotation]', '[data-node-metadata-toggle]:has([data-node-name], [data-node-preview])',
  '[data-context-sources-trigger]', '[data-condensed-from]', '[data-stale-badge]', '[data-attachment-open]',
  '.input-source-heading', '.input-source-open', '[data-local-path]', '[data-export-reading-label]', '[data-reader-material-picker] > button',
].join(',');
const savedFields = '[data-node-paradigm] input, [data-node-paradigm] textarea, [data-note-editor] textarea, [data-frame-title-editor], [data-node-title-input], [data-node-summary-input], [data-canvas-question-editor], [data-canvas-response-editor], [data-pdf-comment-editor] textarea, [data-extraction-editor] textarea';

function asLabel(element: HTMLElement, text?: string) {
  const label = element.ownerDocument.createElement('span');
  for (const { name, value } of [...element.attributes]) {
    if (name === 'class' || name === 'style' || name === 'dir' || name === 'id' || name === 'lang' || name.startsWith('data-')) label.setAttribute(name, value);
  }
  label.removeAttribute('data-tooltip');
  label.setAttribute('data-cursor', 'native');
  if (text === undefined) label.append(...element.childNodes);
  else label.textContent = text;
  element.replaceWith(label);
}

export function applyReadonlyCanvas(root: ParentNode) {
  for (const template of root.querySelectorAll('template')) applyReadonlyCanvas(template.content);
  for (const hit of root.querySelectorAll(Object.values(readonlyOmissions).join(','))) hit.remove();
  for (const field of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(savedFields)) asLabel(field, field.value);
  for (const control of root.querySelectorAll<HTMLElement>('button, input, textarea, select, [role="button"], [role="menuitem"]')) {
    if (control.matches(navigation)) {
      control.tabIndex = 0;
      if (control.matches('[data-open-export-reader], [data-document-open]')) {
        control.setAttribute('aria-label', t('attach.openReader'));
        control.setAttribute('data-tooltip', t('attach.openReader'));
      }
      if (control.dataset.exportRulerLabel) {
        control.setAttribute('aria-label', control.dataset.exportRulerLabel);
        control.setAttribute('data-tooltip', control.dataset.exportRulerLabel);
        control.setAttribute('data-cursor', 'action');
      }
      continue;
    }
    if (control.matches('.react-flow__node, .react-flow__edge')) continue;
    // Markdown task boxes represent saved document content.
    if (control.matches('input[type="checkbox"]') && control.closest('.markdown-body, .document-rich-body, [data-export-reading-body]')) {
      control.setAttribute('disabled', '');
    } else if (control.matches(labels)) {
      control.querySelectorAll('.lucide-chevron-down, .lucide-chevron-right, .lucide-pencil').forEach(icon => icon.remove());
      asLabel(control);
    } else {
      control.remove();
    }
  }
  for (const editable of root.querySelectorAll('[contenteditable], [draggable]')) {
    editable.removeAttribute('contenteditable');
    editable.removeAttribute('draggable');
  }
  for (const menu of root.querySelectorAll('[data-top-toolbar]')) {
    menu.querySelector('[data-frame-nav-trigger]')?.classList.remove('canvas-toolbar-secondary');
    for (const group of menu.querySelectorAll('.canvas-toolbar-group')) if (!group.querySelector('button')) group.remove();
    if (!menu.querySelector('button')) menu.remove();
  }
  for (const empty of root.querySelectorAll('.node-highlight-modes, .pdf-document-toolbar:empty, [data-node-metadata]:empty, .canvas-toolbar-history:empty')) empty.remove();
}
