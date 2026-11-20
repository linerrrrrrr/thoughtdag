/** Files copied from a file manager can also carry their paths as text. */
export function clipboardFilePaste(data: DataTransfer): { files: File[]; preventText: boolean } {
  let files = Array.from(data.files);
  if (!files.length) {
    files = Array.from(data.items)
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => file !== null);
  }
  if (!files.length) return { files, preventText: false };

  const text = data.getData('text/plain').trim();
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const isFilePaths = lines.length === files.length && lines.every((line, index) => {
    let value = line;
    try { value = decodeURIComponent(value); } catch { /* Keep the original text. */ }
    return value === files[index].name || value.endsWith(`/${files[index].name}`)
      || value.endsWith(`\\${files[index].name}`);
  });
  const isImageUrl = files.every(file => file.type.startsWith('image/'))
    && /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#]\S*)?$/i.test(text);
  // Rich text copied from office applications can include a bitmap preview.
  // Prefer its text only when the HTML itself contains text; a copied image
  // may also carry a URL or caption alongside the actual file.
  if (text && !isFilePaths && !isImageUrl && files.every(file => file.type.startsWith('image/'))) {
    const html = data.getData('text/html');
    const htmlText = html.replace(/<!--[\s\S]*?-->|<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ').trim();
    if (htmlText && !/<img\b/i.test(html)) return { files: [], preventText: false };
  }
  return { files, preventText: !text || isFilePaths || isImageUrl };
}
