/** File identity is derived from the uploaded name, never from invented content. */
export function fileIdentity(name: string) {
  const extension = name.split(/[\\/]/).pop()?.match(/\.([a-z\d]{1,10})$/i)?.[1]?.toLowerCase() ?? '';
  const kind = ['csv', 'tsv', 'xlsx', 'xls'].includes(extension) ? 'table'
    : extension === 'ipynb' ? 'notebook'
      : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension) ? 'image'
        : ['py', 'js', 'ts', 'json', 'html', 'xml', 'yaml'].includes(extension) ? 'code' : 'document';
  return { extension: extension ? `.${extension}` : '', kind };
}

export function fileSizeLabel(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}
