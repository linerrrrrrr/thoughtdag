import type { Root, RootContent } from 'mdast';
import type { VFile } from 'vfile';

// CommonMark keeps only the list's starting number. In a user question each
// number can identify a section, including repeated numbers for translations.
export function remarkSourceListNumbers() {
  return (tree: Root, file: VFile) => {
    const source = file.toString();
    function walk(node: Root | RootContent) {
      if (node.type === 'list' && node.ordered) {
        for (const item of node.children) {
          const offset = item.position?.start.offset;
          if (offset === undefined) continue;
          // The parser anchors the item at its marker, even inside a quote or nested list.
          const marker = /^(\d{1,9})[.)]/.exec(source.slice(offset, offset + 10));
          if (marker) {
            item.data ??= {};
            item.data.hProperties = { ...item.data.hProperties, value: Number(marker[1]) };
          }
        }
      }
      if ('children' in node) node.children.forEach(walk);
    }
    walk(tree);
  };
}
