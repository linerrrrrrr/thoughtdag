// Canvas2D measures and paints this exported artwork in the same print units.
const serif = "'Songti SC', 'Noto Serif SC', Georgia, serif";
const mono = "'SF Mono', Menlo, monospace";

export const posterFonts = {
  title: `700 52px ${serif}`,
  journey: `italic 30px ${serif}`,
  body: `28px ${serif}`,
  emphasizedBody: `600 28px ${serif}`,
  eyebrow: `500 22px ${mono}`,
  metadata: `20px ${mono}`,
  label: `600 22px ${mono}`,
  omitted: `italic 24px ${serif}`,
  glyph: `26px ${serif}`,
  signature: `700 34px ${serif}`,
} as const;
