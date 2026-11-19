import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Schema } from 'hast-util-sanitize';
import type { Element, ElementContent, Root, RootContent } from 'hast';
import type { PluggableList } from 'unified';
import { Check, Code2, ClipboardCopy, Workflow } from 'lucide-react';
import { rehypeUserHighlights } from '../lib/rehype-user-highlights';
import { useT, fmt } from '../i18n';
import { localPathOf, basenameOf } from '../lib/local-path';
import { foldToolCalls } from '../lib/tool-markup';
import { normalizeMath } from '../lib/markdown-math';
import { useAppearance } from '../lib/appearance';
import { localTargetOf, safeMarkdownUrl } from '../lib/local-target';
import { ConversationLink } from './ConversationLink';
import { remarkFileCitations } from '../lib/remark-file-citations';

const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkFileCitations];

// Raw HTML in an answer is kept for what it is used for (details, sub/sup,
// kbd, mark, tables, line breaks) and stripped of what can run or embed:
// iframe, object, embed, script, style, link, meta, base, form. An answer is
// untrusted text (a shared graph, an imported project, a model quoting a
// page), and a srcdoc iframe runs with this origin's storage and bridges.
// The sanitizer sits after rehype-raw and before highlight and KaTeX, so
// their own markup (hljs spans, KaTeX styles) is never touched.
const SANITIZE_SCHEMA: Schema = {
  ...defaultSchema,
  // footnote ids already carry mdast's own user-content- prefix; a second one would break their links
  clobberPrefix: '',
  tagNames: [...(defaultSchema.tagNames ?? []), 'mark'],
  attributes: {
    ...defaultSchema.attributes,
    // remark-math marks its code as language-math plus math-inline / math-display; KaTeX reads all three
    code: [['className', /^language-./, 'math-inline', 'math-display']],
    // User highlights injected by this renderer.
    mark: [['className', 'highlight-mark', 'cite-chip'], 'dataNodeCite'],
  },
};
// Rewrite recognized local references before sanitization. This preserves drive
// and file URLs without allowing arbitrary protocols through the sanitizer.
function rehypeLocalFiles() {
  return (tree: Root) => {
    const walk = (node: Root | RootContent) => {
      if (node.type === 'element' && (node.tagName === 'a' || node.tagName === 'img')) {
        const key = node.tagName === 'a' ? 'href' : 'src';
        const target = localTargetOf(typeof node.properties[key] === 'string' ? node.properties[key] as string : undefined);
        if (target) node.properties[key] = `${/^[a-z]:/i.test(target.path) ? '/' : ''}${target.path}${target.line ? `:${target.line}${target.column ? `:${target.column}` : ''}` : ''}`;
      }
      if ('children' in node) node.children.forEach(walk);
    };
    walk(tree);
  };
}
const REHYPE_PLUGINS: PluggableList = [rehypeRaw, rehypeLocalFiles, [rehypeSanitize, SANITIZE_SCHEMA], rehypeHighlight, rehypeKatex];

// Code blocks get a hover copy button (no toast: too frequent an action —
// the icon flashes a check instead).
function CodePre(props: React.HTMLAttributes<HTMLPreElement>) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const t = useT();
  return (
    <div className="relative group/pre">
      <pre {...props} ref={ref} />
      <button
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard.writeText(ref.current?.innerText ?? '');
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
        aria-label={t('common.copyCode')}
        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-control bg-card border border-line text-ink-faint hover:text-accent flex items-center justify-center opacity-0 group-hover/pre:opacity-100 transition-opacity nodrag nopan"
      >
        {copied ? <Check size={12} strokeWidth={2} className="text-green-600" /> : <ClipboardCopy size={12} strokeWidth={1.75} />}
      </button>
    </div>
  );
}

// A ```mermaid block is drawn where there is room to read it (panel,
// reader, viewer). A canvas card draws a fixed-height stand-in instead:
// the card's height is what layout spaced the nodes below by, and a
// diagram arriving after the first paint would grow the card into them.
type DiagramMode = 'render' | 'placeholder';
const DiagramContext = createContext<DiagramMode>('render');

const textOf = (n: ElementContent): string => (n.type === 'text' ? n.value : 'children' in n ? n.children.map(textOf).join('') : '');

function mermaidSource(pre: Element | undefined): string | null {
  const code = pre?.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code');
  const cls = code?.properties?.className;
  if (!code || !Array.isArray(cls) || !cls.includes('language-mermaid')) return null;
  return textOf(code);
}

// mermaid is large: fetched the first time a diagram is drawn, never on a canvas that has none
let mermaidLoad: Promise<typeof import('mermaid').default> | null = null;
const loadMermaid = () => (mermaidLoad ??= import('mermaid').then((m) => m.default));
let mermaidSeq = 0;

function MermaidBlock({ code, source }: { code: string; source: ReactNode }) {
  const t = useT();
  const theme = useAppearance((s) => s.resolved);
  const [svg, setSvg] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  useEffect(() => {
    let live = true;
    // a streaming answer re-renders on every chunk: draw once the text settles;
    // until it parses (a half-written block), the source shows
    const timer = setTimeout(() => {
      void loadMermaid()
        .then(async (mermaid) => {
          // strict: labels are sanitized and the diagram carries no click handlers or scripts
          mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'neutral' });
          if (!(await mermaid.parse(code, { suppressErrors: true }))) { if (live) setSvg(null); return; }
          const out = await mermaid.render(`td-mermaid-${++mermaidSeq}`, code);
          if (live) setSvg(out.svg);
        })
        .catch(() => { if (live) setSvg(null); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [code, theme]);
  const toggle = svg && (
    <button
      onClick={(e) => { e.stopPropagation(); setShowSource((v) => !v); }}
      data-tooltip={showSource ? t('md.diagramView') : t('md.diagramSource')}
      className={`absolute top-1.5 ${showSource ? 'right-9' : 'right-1.5'} w-6 h-6 rounded-control bg-card border border-line text-ink-faint hover:text-accent flex items-center justify-center opacity-0 group-hover/diagram:opacity-100 transition-opacity nodrag nopan`}
      data-diagram-toggle
    >
      {showSource ? <Workflow size={12} strokeWidth={1.75} /> : <Code2 size={12} strokeWidth={1.75} />}
    </button>
  );
  return (
    <div className="relative group/diagram">
      {svg && !showSource
        ? <div className="my-2 overflow-x-auto flex justify-center [&_svg]:max-w-full [&_svg]:h-auto" data-diagram dangerouslySetInnerHTML={{ __html: svg }} />
        : source}
      {toggle}
    </div>
  );
}

function DiagramPlaceholder() {
  const t = useT();
  return (
    <div className="h-12 my-2 flex items-center justify-center gap-1.5 rounded-content border border-dashed border-line text-control text-ink-faint select-none" data-diagram-placeholder>
      <Workflow size={13} strokeWidth={1.75} /> {t('md.diagramPlaceholder')}
    </div>
  );
}

function Pre({ node, ...props }: React.HTMLAttributes<HTMLPreElement> & ExtraProps) {
  const mode = useContext(DiagramContext);
  const code = mermaidSource(node);
  if (code === null) return <CodePre {...props} />;
  if (mode === 'placeholder') return <DiagramPlaceholder />;
  return <MermaidBlock code={code} source={<CodePre {...props} />} />;
}

// Wide tables scroll inside their own container instead of blowing the card
function Table(props: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table {...props} />
    </div>
  );
}

// Links leave the card, never the app. A web URL opens a new tab (the
// desktop shell hands it to the system browser); a LOCAL path — a file
// or folder the agent named — opens on this machine and never becomes a
// web address. Either way the click does not reach the canvas as a node
// selection.
// The writer's working directory, when the text came from a session: a
// relative path in it resolves against this, not against the app.
const BaseContext = createContext<string | undefined>(undefined);

function Anchor(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <ConversationLink {...props} base={useContext(BaseContext)} />;
}

// An image the agent produced shows inline, read from disk through the
// shell; where there is no disk (the browser) a chip names the file.
function LocalImage({ path, alt }: { path: string; alt?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  // no shell, no disk: the chip is final from the first paint
  const [failed, setFailed] = useState(() => !window.desktopLocal);
  useEffect(() => {
    const bridge = window.desktopLocal;
    if (!bridge) return;
    let live = true;
    void bridge.image(path).then((d) => { if (!live) return; if (d) setSrc(d); else setFailed(true); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [path]);
  if (src) {
    return <ConversationLink href={path}><img src={src} alt={alt ?? basenameOf(path)}  className="cursor-zoom-in nopan" /></ConversationLink>;
  }
  return (
    <ConversationLink href={path}
      className={`inline-flex items-center gap-1 text-control border border-line rounded-tag px-1.5 py-0.5 font-mono nopan cursor-pointer ${failed ? 'text-ink-faint' : 'text-ink-muted'}`}
      title={path}
      data-local-image={path}
    >
      🖼 {basenameOf(path)}
    </ConversationLink>
  );
}

function Img({ title, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const local = localPathOf(props.src, useContext(BaseContext));
  if (local) return <LocalImage path={local} alt={props.alt} />;
  return <img {...props} data-tooltip={title} />;
}

const COMPONENTS = { pre: Pre, table: Table, a: Anchor, img: Img };

// Standard markdown rendering (GFM + math + syntax highlighting).
// memo: the unified parse + KaTeX layout is the most expensive render on a
// card, and cards re-render far more often than their text changes (every
// streamed chunk anywhere re-renders every card). Same string → skip.
export const Markdown = memo(function Markdown({ children, base, diagrams = 'render', highlights }: { children: string; base?: string; diagrams?: DiagramMode; highlights?: Set<string> }) {
  const t = useT();
  const plugins = useMemo<PluggableList>(() => highlights?.size
    ? [...REHYPE_PLUGINS, [rehypeUserHighlights, [...highlights]]]
    : REHYPE_PLUGINS, [highlights]);
  // a tool call the model wrote as text did not run: say so in one line instead of showing the markup
  const text = foldToolCalls(normalizeMath(children), (names) => `\n\n> ⚙ ${fmt(t('md.toolCallFolded'), { names: names.map((n) => `\`${n}\``).join(', ') || '?' })}\n\n`);
  return (
    <BaseContext.Provider value={base}>
      <DiagramContext.Provider value={diagrams}>
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={plugins} components={COMPONENTS} urlTransform={safeMarkdownUrl}>
          {text}
        </ReactMarkdown>
      </DiagramContext.Provider>
    </BaseContext.Provider>
  );
});

// Callers rebuild the Set props every render, so memo compares by content.
export const HighlightedMarkdown = memo(function HighlightedMarkdown({ content, highlights, diagrams, base }: HMProps) {
  return <Markdown diagrams={diagrams} base={base} highlights={highlights}>{content}</Markdown>;
}, areMarkPropsEqual);

type HMProps = { content: string; highlights: Set<string>; diagrams?: DiagramMode; base?: string };
function areMarkPropsEqual(prev: HMProps, next: HMProps): boolean {
  if (prev.content !== next.content || prev.diagrams !== next.diagrams || prev.base !== next.base) return false;
  if (prev.highlights.size !== next.highlights.size) return false;
  for (const h of prev.highlights) if (!next.highlights.has(h)) return false;
  return true;
}
