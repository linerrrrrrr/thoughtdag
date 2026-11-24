export function isApiConnectionId(id: unknown): id is string;
export function apiConnectionModelId(sourceId: string, modelId: string): string;
export function parseApiConnectionModelId(id: string | null | undefined): { sourceId: string; modelId: string } | null;
