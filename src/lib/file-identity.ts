/** Use the uploaded name, with the media type as a fallback for images. */
export function fileIdentity(name: string, mime?: string) {
  const extension = name.split(/[\\/]/).pop()?.match(/\.([a-z\d]{1,10})$/i)?.[1]?.toLowerCase() ?? '';
  const kind = ['csv', 'tsv', 'xlsx', 'xls'].includes(extension) ? 'table'
    : extension === 'ipynb' ? 'notebook'
      : ['py', 'js', 'ts', 'json', 'html', 'xml', 'yaml'].includes(extension) ? 'code'
        : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension) || mime?.startsWith('image/') ? 'image' : 'document';
  return { extension: extension ? `.${extension}` : '', kind } as const;
}

export function fileSizeLabel(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}
