import { FileCode2, FileImage, FileText, Notebook, Table2 } from 'lucide-react';
import { fileIdentity } from '../lib/file-identity';

export default function FileIdentity({ name }: { name: string }) {
  const { extension, kind } = fileIdentity(name);
  const Icon = kind === 'table' ? Table2 : kind === 'notebook' ? Notebook : kind === 'image' ? FileImage : kind === 'code' ? FileCode2 : FileText;
  return <span className="file-identity" data-file-kind={kind} aria-hidden="true">
    <Icon size={21} strokeWidth={1.5} />
    {extension && <span>{extension}</span>}
  </span>;
}

