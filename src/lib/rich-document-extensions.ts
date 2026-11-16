import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import { Extension, type Editor } from '@tiptap/core';

// The resize node view applies sizes during dragging, but v3 does not refresh
// them after toolbar edits or history transactions. Keep that DOM in sync too.
const DocumentImage = Image.extend({
  addNodeView() {
    const createView = this.parent?.();
    if (!createView) return null;
    return props => {
      const view = createView(props);
      const update = view.update?.bind(view);
      view.update = (node, decorations, innerDecorations) => {
        const accepted = update?.(node, decorations, innerDecorations) ?? true;
        if (accepted && view.dom instanceof HTMLElement) {
          const image = view.dom.querySelector('img');
          if (image) {
            image.style.width = node.attrs.width ? `${node.attrs.width}px` : '';
            image.style.height = node.attrs.height ? `${node.attrs.height}px` : '';
          }
        }
        return accepted;
      };
      return view;
    };
  },
});

const ParagraphIndent = Extension.create({
  name: 'paragraphIndent',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        indent: {
          default: 0,
          parseHTML: element => {
            const value = element.style.marginLeft;
            const scale = value.endsWith('em') ? 2 : value.endsWith('pt') ? 24 : 32;
            return Math.max(0, Math.min(8, Math.round((parseFloat(value) || 0) / scale)));
          },
          renderHTML: attributes => attributes.indent ? { style: `margin-left: ${attributes.indent * 2}em` } : {},
        },
      },
    }];
  },
});

/** Move each selected paragraph by one step, retaining mixed indentation. */
export function changeParagraphIndent(editor: Editor, delta: number): boolean {
  return editor.chain().focus().command(({ state, tr }) => {
    const { from, to } = state.selection;
    let changed = false;
    state.doc.nodesBetween(from, to, (node, position) => {
      if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
      const indent = Math.max(0, Math.min(8, Number(node.attrs.indent ?? 0) + delta));
      if (indent !== Number(node.attrs.indent ?? 0)) {
        tr.setNodeMarkup(position, undefined, { ...node.attrs, indent });
        changed = true;
      }
    });
    return changed;
  }).run();
}

/** Shared document schema: storage, display and export retain the same basic formatting. */
export function richDocumentExtensions() {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
    TextStyleKit,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ParagraphIndent,
    DocumentImage.configure({
      allowBase64: true,
      resize: { enabled: true, directions: ['bottom-left', 'bottom-right'], minWidth: 40, minHeight: 24, alwaysPreserveAspectRatio: true },
    }),
    TableKit.configure({ table: { resizable: true, renderWrapper: true } }),
  ];
}
