import { FileCode2, FileImage, FileText, Frame, Link2, MessageCircleQuestion, Minimize2, Notebook, SquareTerminal, StickyNote, Table2, UserRound } from 'lucide-react';
import { fileIdentity } from './file-identity';

export const nodeKindIcons = {
  qa: MessageCircleQuestion,
  human: UserRound,
  prompt: SquareTerminal,
  note: StickyNote,
  file: FileText,
  link: Link2,
  frame: Frame,
  distill: Minimize2,
} as const;

export const fileKindIcons = {
  document: FileText,
  table: Table2,
  notebook: Notebook,
  image: FileImage,
  code: FileCode2,
} as const;

export function fileIconFor(name: string, mime?: string) {
  return fileKindIcons[fileIdentity(name, mime).kind];
}
