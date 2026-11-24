import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { onRequest } from '../functions/api/[[path]].js';
import { apiConnectionModelId, parseApiConnectionModelId } from '../runtime/api-model-sources.mjs';

const sharedId = 'vendor/shared:beta';
const visionId = 'vendor/vision';
const alphaId = apiConnectionModelId('alpha', sharedId);
const betaId = apiConnectionModelId('beta', sharedId);
const visionBetaId = apiConnectionModelId('beta', visionId);
assert.deepEqual(parseApiConnectionModelId(betaId), { sourceId: 'beta', modelId: sharedId });

const providersFor = base => [
  { id: 'alpha', name: 'Shared provider', connectionName: 'Alpha account', baseURL: `${base}/alpha/v1`, apiKey: 'alpha-key', models: [{ id: sharedId, vision: true }] },
  { id: 'beta', name: 'Shared provider', baseURL: `${base}/beta/v1`, apiKey: 'beta-key', models: [{ id: sharedId, vision: false }, { id: visionId, vision: true }] },
];
const messages = [{ role: 'user', content: 'hello' }];
const images = [{ data: 'aGVsbG8=', mimeType: 'image/png' }];
const completions = ({ model }) => ({
  id: 'fixture', object: 'chat.completion', created: 0, model,
  choices: [{ index: 0, message: { role: 'assistant', content: 'fixture answer' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

async function checkConnectionRoutes(post, providers, seen, hasEnv = false) {
  const catalog = await post('runtime-providers', { providers });
  assert.equal(catalog.status, 200);
  const { models } = await catalog.json();
  const matching = models.filter(model => model.modelId === sharedId && model.sourceId !== 'env:Ollama');
  assert.deepEqual(matching.map(model => model.id), [alphaId, betaId]);
  assert.deepEqual(matching.map(model => model.sourceLabel), ['Shared provider (1)', 'Shared provider (2)']);
  assert.equal(matching[0].connectionName, 'Alpha account');
  assert.ok(!JSON.stringify(matching).includes('alpha-key'));

  async function check(model, source, upstream, options = {}) {
    const result = await post('claude', { providers, messages, model, ...options });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).model, upstream === visionId ? visionBetaId : model === sharedId ? hasEnv ? sharedId : alphaId : model);
    const call = seen.at(-1);
    assert.equal(call.source, source);
    assert.equal(call.model, upstream);
    if (source !== 'env') assert.equal(call.authorization, `Bearer ${source}-key`);
  }
  await check(alphaId, 'alpha', sharedId);
  await check(betaId, 'beta', sharedId);
  await check(betaId, 'beta', visionId, { images });
  await check(betaId, 'beta', sharedId, { images, providers: [providers[0], { ...providers[1], models: providers[1].models.slice(0, 1) }] });
  await check(sharedId, hasEnv ? 'env' : 'alpha', sharedId);

  const count = seen.length;
  const missing = await post('claude', { providers: providers.slice(0, 1), messages, model: betaId });
  assert.equal(missing.status, 503);
  assert.equal(seen.length, count);
}

const loopback = await (async () => {
  const seen = [];
  const upstream = createServer(async (req, res) => {
    let input = '';
    for await (const chunk of req) input += chunk;
    const body = JSON.parse(input);
    seen.push({ source: req.url.split('/')[1], model: body.model, authorization: req.headers.authorization });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(completions(body)));
  }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const portProbe = createServer().listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const base = `http://127.0.0.1:${upstream.address().port}`;
  const port = String(portProbe.address().port);
  await new Promise(resolve => portProbe.close(resolve));
  const env = { ...process.env, PORT: port, HOST: '127.0.0.1', THOUGHTDAG_DISK_STORAGE: '0', SERVE_DIST: '', OLLAMA_MODELS: sharedId, OLLAMA_BASE_URL: `${base}/env` };
  for (const name of ['ZHIPU_API_KEY', 'DASHSCOPE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'DEEPSEEK_API_KEY', 'MOONSHOT_API_KEY', 'OPENROUTER_API_KEY']) env[name] = '';
  const server = spawn(process.execPath, ['server.mjs'], { env, cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [server.stdout, server.stderr]) stream.on('data', data => { output += data; });
  try {
    for (let i = 0; i < 100 && !output.includes('running on') && server.exitCode === null; i++) await delay(50);
    assert.match(output, /running on/);
    const post = (route, body) => fetch(`http://127.0.0.1:${port}/api/${route}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    await checkConnectionRoutes(post, providersFor(base), seen, true);
    return true;
  } finally {
    server.kill();
    upstream.close();
  }
})();

assert.equal(loopback, true);
const workerFetch = globalThis.fetch;
const workerSeen = [];
try {
  globalThis.fetch = async (url, options) => {
    const req = new Request(url, options);
    const body = await req.json();
    workerSeen.push({ source: new URL(req.url).pathname.split('/')[1], model: body.model, authorization: req.headers.get('authorization') });
    return Response.json(completions(body));
  };
  const post = (route, body) => onRequest({
    request: new Request(`https://fixture.invalid/api/${route}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    params: { path: [route] },
  });
  await checkConnectionRoutes(post, providersFor('https://upstream.invalid'), workerSeen);
} finally {
  globalThis.fetch = workerFetch;
}
console.log('API connection catalog and Node/Workers routing passed');
