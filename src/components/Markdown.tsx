import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Schema } from 'hast-util-sanitize';
import type { Element, ElementContent } from 'hast';
import type { PluggableList } from 'unified';
import { Check, Code2, ClipboardCopy, FileImage, Workflow } from 'lucide-react';
import { rehypeUserHighlights } from '../lib/rehype-user-highlights';
import { useT, fmt } from '../i18n';
import { localPathOf, basenameOf } from '../lib/local-path';
import { foldToolCalls } from '../lib/tool-markup';
import { normalizeMath } from '../lib/markdown-math';
import { renderMarkdownDiagram } from '../lib/markdown-diagram';
import { useAppearance } from '../lib/appearance';
import { rehypeLocalFiles, safeMarkdownUrl } from '../lib/local-target';
import { ConversationLink } from './ConversationLink';
import { remarkFileCitations } from '../lib/remark-file-citations';
import { remarkSourceListNumbers } from '../lib/remark-source-list-numbers';
import { activeCodexVisuals, isCodexVisualAnswer, parseCodexVisuals } from '../lib/codex-visuals';
import type { ThoughtData } from '../types';
import { CodexVisual } from './CodexVisual';

const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkFileCitations];
const QUESTION_REMARK_PLUGINS = [...REMARK_PLUGINS, remarkSourceListNumbers];

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
const REHYPE_PLUGINS: PluggableList = [rehypeRaw, rehypeLocalFiles, [rehypeSanitize, SANITIZE_SCHEMA], rehypeHighlight, rehypeKatex];

// Code blocks get a hover copy button (no toast: too frequent an action —
// the icon flashes a check instead).
function CodePre(props: React.HTMLAttributes<HTMLPreElement>) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const t = useT();
  return (
    <div className="relative group/pre">
      <pre {...props} data-cursor="text" ref={ref} />
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
      void renderMarkdownDiagram(code, theme === 'dark')
        .then(result => { if (live) setSvg(result ?? null); })
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
        ? <div className="my-2 overflow-x-auto flex justify-center [&_svg]:max-w-full [&_svg]:h-auto" data-type-surface="native-document" data-diagram dangerouslySetInnerHTML={{ __html: svg }} />
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
      <table {...props} data-cursor="text" />
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
    return <ConversationLink href={path}><img src={src} alt={alt ?? basenameOf(path)}  data-cursor="zoom-in" className="nopan" /></ConversationLink>;
  }
  return (
    <ConversationLink href={path}
      data-cursor="action" className={`inline-flex items-center gap-1 text-control border border-line rounded-tag px-1.5 py-0.5 font-mono nopan ${failed ? 'text-ink-faint' : 'text-ink-muted'}`}
      title={path}
      data-local-image={path}
    >
      <FileImage size={14} strokeWidth={1.75} aria-hidden="true" /> {basenameOf(path)}
    </ConversationLink>
  );
}

function Img({ title, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const local = localPathOf(props.src, useContext(BaseContext));
  if (local) return <LocalImage path={local} alt={props.alt} />;
  return <img {...props} data-cursor="native" data-tooltip={title} />;
}

type Visuals = ReturnType<typeof activeCodexVisuals>;
type VisualBlock = { path: string; title?: string; html?: string };
const VisualBlocks = createContext<ReadonlyMap<number, VisualBlock> | undefined>(undefined);

// Retain a single Markdown tree so links, footnotes, and highlights can span
// a preview. Positions bind only recognized references to their answer's files.
function prepareVisualBlocks(source: string, visuals?: Visuals) {
  const refs = visuals && parseCodexVisuals(source);
  if (!refs?.length) return { text: source, blocks: undefined };
  const blocks = new Map<number, VisualBlock>();
  let text = '';
  let end = 0;
  for (const ref of refs) {
    text += source.slice(end, ref.start) + '\n\n';
    const snapshot = visuals?.find(item => item?.path === ref.path && typeof item.html === 'string');
    blocks.set(text.length, { ...ref, html: snapshot?.html });
    text += '\uFFFC\n\n';
    end = ref.end;
  }
  return { text: text + source.slice(end), blocks };
}

function Paragraph({ node, children, ...props }: React.HTMLAttributes<HTMLParagraphElement> & ExtraProps) {
  const blocks = useContext(VisualBlocks);
  const block = blocks?.get(node?.position?.start.offset ?? -1);
  return block ? <CodexVisual {...block} /> : <p {...props} data-cursor="text">{children}</p>;
}

const COMPONENTS = { pre: Pre, table: Table, a: Anchor, img: Img };
const VISUAL_COMPONENTS = { ...COMPONENTS, p: Paragraph };

// Standard markdown rendering (GFM + math + syntax highlighting).
// memo: the unified parse + KaTeX layout is the most expensive render on a
// card, and cards re-render far more often than their text changes (every
// streamed chunk anywhere re-renders every card). Same string → skip.
export const Markdown = memo(function Markdown({ children, base, diagrams = 'render', highlights, preserveListNumbers, visuals }: {
  children: string; base?: string; diagrams?: DiagramMode; highlights?: Set<string>; preserveListNumbers?: boolean; visuals?: Visuals;
}) {
  const t = useT();
  const plugins = useMemo<PluggableList>(() => highlights?.size
    ? [...REHYPE_PLUGINS, [rehypeUserHighlights, [...highlights]]]
    : REHYPE_PLUGINS, [highlights]);
  // a tool call the model wrote as text did not run: say so in one line instead of showing the markup
  const text = foldToolCalls(normalizeMath(children), (names) => `\n\n> ⚙ ${fmt(t('md.toolCallFolded'), { names: names.map((n) => `\`${n}\``).join(', ') || '?' })}\n\n`);
  const prepared = useMemo(() => prepareVisualBlocks(text, visuals), [text, visuals]);
  return (
    <BaseContext.Provider value={base}>
      <DiagramContext.Provider value={diagrams}>
        <VisualBlocks.Provider value={prepared.blocks}>
          <ReactMarkdown remarkPlugins={preserveListNumbers ? QUESTION_REMARK_PLUGINS : REMARK_PLUGINS} rehypePlugins={plugins} components={prepared.blocks ? VISUAL_COMPONENTS : COMPONENTS} urlTransform={safeMarkdownUrl}>
            {prepared.text}
          </ReactMarkdown>
        </VisualBlocks.Provider>
      </DiagramContext.Provider>
    </BaseContext.Provider>
  );
});

// Callers rebuild the Set props every render, so memo compares by content.
export const HighlightedMarkdown = memo(function HighlightedMarkdown({ content, highlights, diagrams, base, visuals }: HMProps) {
  return <Markdown diagrams={diagrams} base={base} highlights={highlights} visuals={visuals}>{content}</Markdown>;
}, areMarkPropsEqual);

type HMProps = { content: string; highlights: Set<string>; diagrams?: DiagramMode; base?: string; visuals?: Visuals };
function areMarkPropsEqual(prev: HMProps, next: HMProps): boolean {
  if (prev.content !== next.content || prev.diagrams !== next.diagrams || prev.base !== next.base || prev.visuals !== next.visuals) return false;
  if (prev.highlights.size !== next.highlights.size) return false;
  for (const h of prev.highlights) if (!next.highlights.has(h)) return false;
  return true;
}

export function AnswerMarkdown({ data, text = data.response, highlights, diagrams }: {
  data: ThoughtData; text?: string; highlights?: Set<string>; diagrams?: DiagramMode;
}) {
  const base = data.agentSession?.cwd ?? data.importSource?.cwd;
  const visuals = isCodexVisualAnswer(data) ? activeCodexVisuals(data) : undefined;
  return highlights?.size
    ? <HighlightedMarkdown content={text} base={base} diagrams={diagrams} highlights={highlights} visuals={visuals} />
    : <Markdown base={base} diagrams={diagrams} visuals={visuals}>{text}</Markdown>;
}
