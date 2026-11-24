const MODEL_SOURCE_PREFIX = 'api-connection:';

export function isApiConnectionId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
}

export function apiConnectionModelId(sourceId, modelId) {
  return `${MODEL_SOURCE_PREFIX}${sourceId}:${encodeURIComponent(modelId)}`;
}

export function parseApiConnectionModelId(id) {
  if (typeof id !== 'string' || !id.startsWith(MODEL_SOURCE_PREFIX)) return null;
  const value = id.slice(MODEL_SOURCE_PREFIX.length);
  const separator = value.indexOf(':');
  const sourceId = value.slice(0, separator);
  if (separator < 0 || !isApiConnectionId(sourceId)) return null;
  try {
    const modelId = decodeURIComponent(value.slice(separator + 1));
    return modelId ? { sourceId, modelId } : null;
  } catch {
    return null;
  }
}

/** Keep qualified catalog rows distinct while preserving the first legacy model route. */
export function apiProviderCatalog(providers, entryFactory, existingSourceNames = []) {
  const entries = Object.create(null);
  const aliases = new Map();
  const names = new Map();
  const ordinals = new Map();
  const sources = new Set();
  const connections = [];
  const countName = (map, name) => {
    const count = (map.get(name) ?? 0) + 1;
    map.set(name, count);
    return count;
  };
  for (const name of existingSourceNames) {
    countName(names, name);
    countName(ordinals, name);
  }
  for (const provider of (Array.isArray(providers) ? providers : []).slice(0, 12)) {
    const baseURL = String(provider?.baseURL ?? '').replace(/\/$/, '');
    if (!baseURL) continue;
    const models = (Array.isArray(provider.models) ? provider.models : [])
      .map(model => typeof model === 'string' ? { id: model } : model)
      .filter(model => typeof model?.id === 'string' && model.id).slice(0, 60);
    if (!models.length) continue;
    const name = String(provider.name || 'Custom').slice(0, 40);
    const sourceId = isApiConnectionId(provider.id) ? provider.id : undefined;
    if (sourceId && sources.has(sourceId)) continue;
    if (sourceId) sources.add(sourceId);
    const connectionName = typeof provider.connectionName === 'string' ? provider.connectionName.trim().slice(0, 60) : '';
    countName(names, name);
    connections.push({ provider, baseURL, name, sourceId, connectionName, models });
  }
  for (const { provider, baseURL, name, sourceId, connectionName, models } of connections) {
    const ordinal = countName(ordinals, name);
    const sourceLabel = names.get(name) > 1 ? `${name} (${ordinal})` : name;
    const makeEntry = entryFactory(provider, baseURL, name);
    for (const model of models) {
      let id;
      try { id = sourceId ? apiConnectionModelId(sourceId, model.id) : model.id; }
      catch { continue; }
      if (Object.hasOwn(entries, id)) continue;
      const shortId = model.id.includes('/') ? model.id.slice(model.id.indexOf('/') + 1) : model.id;
      entries[id] = {
        ...makeEntry(model), name: `${shortId} (${name})`, provider: name,
        ...(sourceId ? { modelId: model.id, sourceId, sourceLabel, ...(connectionName ? { connectionName } : {}) } : {}),
      };
      if (!aliases.has(model.id)) aliases.set(model.id, id);
    }
  }
  return { entries, aliases };
}

export function apiCatalogModel(id, entry) {
  const { name, provider, vision, modelId, sourceId, sourceLabel, connectionName } = entry;
  return { id, name, provider, vision, modelId, sourceId, sourceLabel, connectionName };
}
