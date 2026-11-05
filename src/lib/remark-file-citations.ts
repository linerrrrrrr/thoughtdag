import type { PhrasingContent, Root, RootContent } from 'mdast';
import { basenameOf, localTargetOf } from './local-target';

// Native file citations are display metadata, never HTML or executable actions.
// Transform only prose text: code examples and existing links keep their source.
export function remarkFileCitations() {
  return (tree: Root) => {
    const walk = (node: Root | RootContent) => {
      if (node.type === 'link' || node.type === 'linkReference' || !('children' in node)) return;
      node.children = node.children.flatMap((child): typeof node.children => {
        if (child.type !== 'text') { walk(child); return [child]; }
        const parts: PhrasingContent[] = [];
        let end = 0;
        for (const match of child.value.matchAll(/:{1,2}codex-file-citation\{((?:[^{}"']|"[^"]*"|'[^']*')*)\}/g)) {
          const attrs = match[1];
          if (!/^\s*(?:[\w-]+\s*=\s*(?:"[^"]*"|'[^']*')\s*)+$/.test(attrs)) continue;
          const paths = [...attrs.matchAll(/(?:^|\s)path\s*=\s*(?:"([^"]*)"|'([^']*)')/g)];
          const path = paths.length === 1 ? paths[0][1] ?? paths[0][2] : '';
          // A placeholder base validates relative paths; the ConversationLink
          // resolves them against the actual session's working directory.
          if (!localTargetOf(path, '/')) continue;
          if (match.index > end) parts.push({ type: 'text', value: child.value.slice(end, match.index) });
          parts.push({ type: 'link', url: path.replace(/\\/g, '/'), children: [{ type: 'text', value: basenameOf(path) }] });
          end = match.index + match[0].length;
        }
        if (!end) return [child];
        if (end < child.value.length) parts.push({ type: 'text', value: child.value.slice(end) });
        return parts;
      });
    };
    walk(tree);
  };
}
