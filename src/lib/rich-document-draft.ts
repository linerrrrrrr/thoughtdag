/** Rich document drafts never share a namespace with the retired Markdown editor. */
export const richDocumentDraftKey = (projectId: string | null, nodeId: string, attachmentId: string) =>
  `rich-document:${projectId ?? 'default'}:${nodeId}:${attachmentId}`;
