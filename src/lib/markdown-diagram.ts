let sequence = 0;

/** Render once in the application. A static export can carry the resulting image. */
export async function renderMarkdownDiagram(source: string, dark: boolean, svgLabels = false): Promise<string | undefined> {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral',
    htmlLabels: !svgLabels });
  if (!await mermaid.parse(source, { suppressErrors: true })) return;
  return (await mermaid.render(`td-mermaid-${++sequence}`, source)).svg;
}
