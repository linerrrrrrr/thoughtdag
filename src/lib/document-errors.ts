import type { MessageKey } from '../i18n';

export class DocumentSourceError extends Error {
  readonly key: MessageKey;
  constructor(key: MessageKey) { super(key); this.key = key; }
}

export function documentWriteError(error: unknown): MessageKey {
  return error instanceof DocumentSourceError ? error.key : 'document.writeFailed';
}
