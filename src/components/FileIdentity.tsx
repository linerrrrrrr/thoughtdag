import { fileKindIcons } from '../lib/content-icons';
import { fileIdentity } from '../lib/file-identity';

export default function FileIdentity({ name, mime }: { name: string; mime?: string }) {
  const { extension, kind } = fileIdentity(name, mime);
  const Icon = fileKindIcons[kind];
  return <span className="file-identity" data-file-kind={kind} aria-hidden="true">
    <Icon size={21} strokeWidth={1.5} />
    {extension && <span>{extension}</span>}
  </span>;
}

