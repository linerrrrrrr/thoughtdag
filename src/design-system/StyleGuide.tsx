import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { AlignLeft, BookOpen, Check, ChevronDown, Copy, LoaderCircle, MoreHorizontal, Pencil, RotateCcw, Settings2, Trash2, Wrench } from 'lucide-react';

type Language = 'zh' | 'en';
type CopyPair = readonly [string, string];
const wording = {
  title: ['设计规范样张', 'Design reference'],
  intro: ['用于开发核对的真实样式样本。切换主题、语言与预览宽度，比较同一语义角色在不同界面中的表现。', 'A development reference using the application’s real styles. Compare semantic roles across themes, languages, and preview widths.'],
  local: ['所有操作仅作用于当前样张；刷新后恢复，不连接模型或修改画布数据。', 'All interactions stay in this page and reset on reload. No model connection or canvas data changes.'],
  language: ['语言', 'Language'], theme: ['主题', 'Theme'], width: ['预览宽度', 'Preview width'],
  light: ['浅色', 'Light'], dark: ['深色', 'Dark'],
  surfaces: ['界面样本', 'Surface specimens'],
  surfaceNote: ['共享字号、内边距和圆角；阅读区、工具区各自保留内容结构。预览宽度不超过当前可用空间。', 'Shared typography, insets, and radii with surface-specific structure. Preview width is capped by available space.'],
  tools: ['工具卡片', 'Tool card'], conversation: ['完整问答卡', 'Conversation card'], reader: ['详情阅读', 'Reading panel'], editing: ['文本与状态', 'Text and states'],
  more: ['更多', 'More'], format: ['对象格式', 'Object format'], appearance: ['显示密度', 'Display density'],
  full: ['完整', 'Full'], summary: ['简略', 'Summary'], compact: ['极简', 'Compact'],
  selectedObject: ['已选中 1 个节点', '1 node selected'], dimensions: ['尺寸', 'Dimensions'],
  widthField: ['宽度', 'Width'], heightField: ['高度', 'Height'], arrange: ['排列', 'Arrange'],
  align: ['左对齐', 'Align left'], preview: ['预览', 'Preview'], apply: ['应用', 'Apply'],
  sampleSettings: ['这里只预览控件状态，不改变节点尺寸。', 'These controls preview their states without changing node geometry.'],
  sampleApplied: ['已在样张中应用。', 'Applied within this specimen.'],
  samplePreview: ['当前样张预览已更新。', 'The specimen preview is updated.'],
  titleSample: ['让同一套设计规则覆盖每一处工作界面', 'One design language across every working surface'],
  name: ['名称与摘要', 'Name and summary'],
  question: ['怎样让工具栏、画布节点和详情阅读区保持一致，又保留各自的阅读密度？', 'How can toolbars, canvas nodes, and reading panels stay consistent while retaining the density each task needs?'],
  answerIntro: ['同一语义角色使用同一组字号、行高和字重。工具区优先便于扫读，问答正文留出稳定的阅读节奏。', 'Use the same size, line height, and weight for the same semantic role. Tools support scanning; conversation text keeps a steady reading rhythm.'],
  answerHeading: ['从用途选择样式', 'Choose styles by purpose'],
  answerControl: ['控件', 'Controls'], answerControlDetail: ['名称短而明确，状态可辨。', 'Concise names and visible states.'],
  answerBody: ['正文', 'Body text'], answerBodyDetail: ['中英文与长名称自然换行，代码在自身区域滚动。', 'Readable prose and long names, with code scrolling within its own area.'],
  answerSurface: ['容器', 'Surfaces'], answerSurfaceDetail: ['复用语义内边距与圆角，避免重复包裹。', 'Shared semantic insets and corners without repeated wrappers.'],
  bodyTokenDetail: ['负责正文，', ' governs prose; '], insetTokenDetail: ['负责内容边距。', ' governs content insets.'],
  example: ['示例内容', 'Sample content'], completed: ['已完成', 'Complete'],
  read: ['阅读', 'Read'], copy: ['复制', 'Copy'], revise: ['修订', 'Revise'],
  sampleAction: ['已触发样张动作；没有写入画布。', 'Specimen action triggered; no canvas data was written.'],
  textareaLabel: ['正文输入样本', 'Body input sample'], textareaPlaceholder: ['输入中英文或多行内容，观察自动换行与焦点边界。', 'Type mixed-language or multiline content to inspect wrapping and focus.'],
  textareaHint: ['Enter 换行。输入仅保留在当前页面内存中。', 'Enter inserts a line break. Input lives only in this page’s memory.'],
  render: ['预览输入', 'Preview input'], reset: ['清空样张', 'Clear sample'],
  empty: ['输入预览将在这里显示。', 'Your input preview will appear here.'],
  stateLabel: ['按钮状态', 'Button states'], normal: ['普通', 'Default'], active: ['选中', 'Selected'],
  disabled: ['不可用', 'Disabled'], busy: ['处理中', 'Working'], danger: ['删除样本', 'Delete sample'],
  error: ['示例错误：内容为空，请输入后再预览。', 'Example error: enter some content before previewing.'],
  typography: ['字号角色', 'Type roles'], typographyNote: ['样本文字直接使用当前 CSS token；正文与标题可共用字号，通过字重和行高区分用途。', 'Samples read the current CSS tokens directly. Body and title can share a size while weight and line height express their roles.'],
  token: ['Token', 'Token'], role: ['用途', 'Purpose'], specimen: ['样本', 'Sample'],
  color: ['颜色与状态', 'Color and state'], colorNote: ['底色、文字和边界随深浅主题切换；强调色仍保留各自语义。', 'Surface, text, and boundary colors follow the selected theme while semantic accents retain their purpose.'],
  geometry: ['间距与圆角', 'Spacing and corners'], geometryNote: ['色块展示当前 token 的实际几何尺寸；这些是规范样本，不是新的视觉常量。', 'The shapes show the current token geometry. They document existing values rather than introducing new visual constants.'],
} satisfies Record<string, CopyPair>;
type CopyKey = keyof typeof wording;
type Translate = (key: CopyKey) => string;

const typeRoles: { role: string; purpose: CopyPair; weight?: number }[] = [
  { role: 'meta', purpose: ['时间、计数与补充信息', 'Timestamps, counts, supporting information'] },
  { role: 'control', purpose: ['按钮、菜单与表单标签', 'Buttons, menus, field labels'] },
  { role: 'body', purpose: ['问题、回答与长文', 'Questions, answers, and prose'] },
  { role: 'title', purpose: ['面板与卡片标题', 'Panel and card titles'], weight: 600 },
  { role: 'heading', purpose: ['正文小标题', 'Body subheadings'], weight: 600 },
  { role: 'section', purpose: ['页面分区标题', 'Page section headings'], weight: 600 },
  { role: 'page', purpose: ['页面标题', 'Page title'], weight: 600 },
];
const colors = ['surface', 'card', 'wash', 'line', 'ink', 'ink-muted', 'ink-faint', 'accent', 'action', 'material-note', 'material-file-wash', 'watch'];
const spaces = ['control-gap', 'related', 'toolbar-inset', 'section-gap', 'surface-inset', 'canvas-inset', 'control-size'];
const radii = ['port', 'tag', 'control', 'content', 'node', 'overlay', 'panel', 'toolbar'];
const plainAction = 'min-h-8 px-2.5 rounded-control text-control text-ink-muted hover:bg-wash flex items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 disabled:cursor-not-allowed';
const primaryAction = 'min-h-8 px-3 rounded-control text-control bg-action text-white hover:bg-action-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40 disabled:cursor-not-allowed';

function Choice({ label, name, value, options, onChange }: { label: string; name: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <fieldset className="canvas-layout-field ds-choice" data-choice={name}>
    <legend>{label}</legend>
    <div className="canvas-layout-choices" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(option => <label className="canvas-layout-choice" key={option.value}>
        <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
        <span>{option.label}</span>
      </label>)}
    </div>
  </fieldset>;
}

function Sample({ name, title, children }: { name: string; title: string; children: ReactNode }) {
  return <section className="ds-sample" aria-labelledby={`sample-${name}`}>
    <h3 id={`sample-${name}`} className="ds-sample-title">{title}</h3>
    {children}
  </section>;
}

// Render fixture text without importing parsers that initialize browser storage.
function Prose({ text, className = '' }: { text: string; className?: string }) {
  return <div className={`markdown-body ${className}`}><p className="ds-plain-prose">{text}</p></div>;
}

// Use the same semantic HTML and CSS as rendered application prose. The fixture
// needs no Markdown engine, application stores, links, or external media.
function AnswerProse({ t, className }: { t: Translate; className: string }) {
  return <div className={`markdown-body ${className}`}>
    <p>{t('answerIntro')}</p>
    <h3>{t('answerHeading')}</h3>
    <ul>
      <li><strong>{t('answerControl')}</strong>：{t('answerControlDetail')}</li>
      <li><strong>{t('answerBody')}</strong>：{t('answerBodyDetail')}</li>
      <li><strong>{t('answerSurface')}</strong>：{t('answerSurfaceDetail')}</li>
    </ul>
    <p><code>--text-body</code> {t('bodyTokenDetail')}<code>--spacing-surface-inset</code> {t('insetTokenDetail')}</p>
  </div>;
}

function ToolSpecimen({ t }: { t: Translate }) {
  const [mode, setMode] = useState('more');
  const [density, setDensity] = useState('full');
  const [notice, setNotice] = useState<CopyKey | null>(null);
  return <div className="ds-tool-specimen" data-specimen="tools">
    <div className="canvas-toolbar" role="group" aria-label={t('tools')}>
      <button type="button" className="canvas-toolbar-button canvas-toolbar-icon" aria-pressed={mode === 'more'} onClick={() => setMode('more')}><MoreHorizontal aria-hidden="true" /><span>{t('more')}</span></button>
      <button type="button" className="canvas-toolbar-button canvas-toolbar-icon" aria-pressed={mode === 'format'} onClick={() => setMode('format')}><Settings2 aria-hidden="true" /><span>{t('format')}</span></button>
    </div>
    <section className="canvas-tool-panel ds-tool-panel" aria-label={mode === 'more' ? t('more') : t('format')}>
      <header className="ds-tool-heading"><h4>{mode === 'more' ? t('more') : t('format')}</h4><p>{t('selectedObject')}</p></header>
      <div className="canvas-layout-fields">
        {mode === 'more' ? <Choice label={t('appearance')} name="sample-density" value={density} onChange={setDensity} options={['full', 'summary', 'compact'].map(value => ({ value, label: t(value as CopyKey) }))} /> : <fieldset className="canvas-layout-field">
          <legend>{t('dimensions')}</legend>
          <div className="ds-dimensions">
            <label>{t('widthField')}<input type="number" min="1" defaultValue="520" aria-label={t('widthField')} /></label>
            <label>{t('heightField')}<input type="number" min="1" defaultValue="320" aria-label={t('heightField')} /></label>
          </div>
        </fieldset>}
        <fieldset className="canvas-layout-field"><legend>{t('arrange')}</legend><button type="button" className={plainAction} onClick={() => setNotice('sampleAction')}><AlignLeft aria-hidden="true" />{t('align')}</button></fieldset>
        <p className="ds-caption">{t('sampleSettings')}</p>
      </div>
      <footer className="ds-tool-footer"><button type="button" className={plainAction} onClick={() => setNotice('samplePreview')}>{t('preview')}</button><button type="button" className={primaryAction} onClick={() => setNotice('sampleApplied')}>{t('apply')}</button></footer>
    </section>
    <p role="status" className="ds-notice">{notice ? t(notice) : '\u00a0'}</p>
  </div>;
}

function AnswerActions({ t }: { t: Translate }) {
  const [notice, setNotice] = useState(false);
  return <><div className="conversation-actions ds-action-row">
    <button type="button" className={plainAction} onClick={() => setNotice(true)}><Copy aria-hidden="true" />{t('copy')}</button>
    <button type="button" className={plainAction} onClick={() => setNotice(true)}><Pencil aria-hidden="true" />{t('revise')}</button>
  </div><p className="ds-notice" role="status">{notice ? t('sampleAction') : '\u00a0'}</p></>;
}

function ConversationSpecimen({ t }: { t: Translate }) {
  return <article className="thought-node conversation-node" data-specimen="conversation" aria-label={t('conversation')}>
    <header className="thought-node-header ds-node-header">
      <div className="ds-node-identity"><span className="node-start-label">{t('completed')}</span><span className="node-token-usage"><span className="node-token-heading"><span className="node-token-total">1,280 tokens</span><span className="node-tool-marks"><Wrench aria-hidden="true" />2</span></span></span></div>
      <BookOpen className="ds-header-icon" aria-hidden="true" />
    </header>
    <div className="node-metadata"><div className="node-metadata-toggle"><ChevronDown aria-hidden="true" /><span>{t('name')}</span></div><h4 className="ds-node-name">{t('titleSample')}</h4></div>
    <div data-thought-body>
      <div className="conversation-question"><Prose text={t('question')} className="conversation-user-message" /></div>
      <AnswerProse t={t} className="conversation-answer" />
      <AnswerActions t={t} />
    </div>
  </article>;
}

function ReaderSpecimen({ t }: { t: Translate }) {
  return <article className="focus-panel-shell ds-reader" data-specimen="reader" aria-label={t('reader')}>
    <header className="focus-panel-header ds-reader-heading"><h4 className="focus-panel-title">{t('titleSample')}</h4><span className="ds-caption">{t('example')}</span></header>
    <div className="focus-panel-content">
      <div className="focus-question-section"><div className="focus-user-turn"><Prose text={t('question')} className="focus-user-message" /></div></div>
      <div className="focus-response-section"><AnswerProse t={t} className="focus-assistant-message" /><div className="focus-response-actions"><AnswerActions t={t} /></div></div>
    </div>
  </article>;
}

function EditingSpecimen({ t }: { t: Translate }) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState('');
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState(true);
  const [action, setAction] = useState(false);
  return <div className="ds-editor" data-specimen="editing">
    <label htmlFor={id} className="ds-field-label">{t('textareaLabel')}</label>
    <div className="focus-message-editor"><textarea id={id} data-sample-input rows={4} value={draft} onChange={event => { setDraft(event.target.value); setError(false); }} placeholder={t('textareaPlaceholder')} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} aria-invalid={error || undefined} /></div>
    <p className="ds-caption" id={`${id}-hint`}>{t('textareaHint')}</p>
    {error && <p className="ds-error" role="alert" id={`${id}-error`}>{t('error')}</p>}
    <div className="ds-action-row"><button type="button" className={primaryAction} data-sample-preview onClick={() => { setError(!draft.trim()); if (draft.trim()) setPreview(draft); }}>{t('render')}</button><button type="button" className={plainAction} onClick={() => { setDraft(''); setPreview(''); setError(false); }}><RotateCcw aria-hidden="true" />{t('reset')}</button></div>
    <div className="ds-input-preview" aria-live="polite">{preview ? <Prose text={preview} /> : <p className="ds-caption">{t('empty')}</p>}</div>
    <fieldset className="canvas-layout-field ds-state-field"><legend>{t('stateLabel')}</legend><div className="ds-action-row">
      <button type="button" className={plainAction} onClick={() => setAction(true)}>{t('normal')}</button>
      <button type="button" className="canvas-toolbar-button canvas-toolbar-icon" aria-pressed={selected} onClick={() => setSelected(value => !value)}><Check aria-hidden="true" />{t('active')}</button>
      <button type="button" className={plainAction} disabled>{t('disabled')}</button>
      <button type="button" className={plainAction} disabled aria-busy="true"><LoaderCircle aria-hidden="true" />{t('busy')}</button>
      <button type="button" className={`${plainAction} text-watch`} onClick={() => setAction(true)}><Trash2 aria-hidden="true" />{t('danger')}</button>
    </div></fieldset>
    <p className="ds-notice" role="status">{action ? t('sampleAction') : '\u00a0'}</p>
  </div>;
}

export function StyleGuide() {
  const [language, setLanguage] = useState<Language>('zh');
  const [theme, setTheme] = useState('light');
  const [width, setWidth] = useState('380');
  const t: Translate = key => wording[key][language === 'zh' ? 0 : 1];
  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.documentElement.dataset.theme = theme;
    document.title = `ThoughtDAG · ${wording.title[language === 'zh' ? 0 : 1]}`;
  }, [language, theme]);
  return <main className="ds-page" data-design-system data-language={language} data-preview-width={width} style={{ '--specimen-width': `${width}px` } as CSSProperties}>
    <header className="ds-page-header"><h1>{t('title')}</h1><p>{t('intro')}</p><p className="ds-caption">{t('local')}</p></header>
    <div className="ds-controls">
      <Choice label={t('language')} name="language" value={language} onChange={value => setLanguage(value as Language)} options={[{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }]} />
      <Choice label={t('theme')} name="theme" value={theme} onChange={setTheme} options={[{ value: 'light', label: t('light') }, { value: 'dark', label: t('dark') }]} />
      <Choice label={t('width')} name="preview-width" value={width} onChange={setWidth} options={['320', '380', '520'].map(value => ({ value, label: `${value}px` }))} />
    </div>
    <section className="ds-section" aria-labelledby="surfaces-title"><h2 id="surfaces-title">{t('surfaces')}</h2><p className="ds-section-note">{t('surfaceNote')}</p><div className="ds-specimens">
      <Sample name="tools" title={t('tools')}><ToolSpecimen t={t} /></Sample>
      <Sample name="conversation" title={t('conversation')}><ConversationSpecimen t={t} /></Sample>
      <Sample name="reader" title={t('reader')}><ReaderSpecimen t={t} /></Sample>
      <Sample name="editing" title={t('editing')}><EditingSpecimen t={t} /></Sample>
    </div></section>
    <section className="ds-section" aria-labelledby="type-title"><h2 id="type-title">{t('typography')}</h2><p className="ds-section-note">{t('typographyNote')}</p><div className="ds-table-scroll"><table className="ds-type-table"><thead><tr><th scope="col">{t('token')}</th><th scope="col">{t('role')}</th><th scope="col">{t('specimen')}</th></tr></thead><tbody>{typeRoles.map(item => <tr key={item.role}><th scope="row"><code>--text-{item.role}</code></th><td>{item.purpose[language === 'zh' ? 0 : 1]}</td><td data-type-role={item.role} style={{ fontSize: `var(--text-${item.role})`, lineHeight: `var(--text-${item.role}--line-height)`, fontWeight: item.weight }}>{language === 'zh' ? '让思考清晰可见 Aa 0123' : 'Make thinking visible Aa 0123'}</td></tr>)}</tbody></table></div></section>
    <section className="ds-section" aria-labelledby="colors-title"><h2 id="colors-title">{t('color')}</h2><p className="ds-section-note">{t('colorNote')}</p><div className="ds-token-grid">{colors.map(color => <figure className="ds-color-token" key={color}><div aria-hidden="true" style={{ background: `var(--color-${color})` }} /><figcaption><code>--color-{color}</code></figcaption></figure>)}</div></section>
    <section className="ds-section" aria-labelledby="geometry-title"><h2 id="geometry-title">{t('geometry')}</h2><p className="ds-section-note">{t('geometryNote')}</p><div className="ds-geometry"><div className="ds-space-list">{spaces.map(space => <figure className="ds-space-token" key={space}><span aria-hidden="true" style={{ width: `var(--spacing-${space})` }} /><figcaption><code>--spacing-{space}</code></figcaption></figure>)}</div><div className="ds-radius-grid">{radii.map(radius => <figure key={radius}><span aria-hidden="true" style={{ borderRadius: `var(--radius-${radius})` }} /><figcaption><code>--radius-{radius}</code></figcaption></figure>)}</div></div></section>
  </main>;
}
