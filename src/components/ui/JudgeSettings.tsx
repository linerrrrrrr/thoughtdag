import { useEffect, useState } from 'react';
import { Loader2, Scale } from 'lucide-react';
import { useUiStore } from '../../lib/ui-store';
import { judgeSelfTest, storedOpenRouterKey, judgeConfigured, judgeTripped, effectiveProvider, type JudgeProviderId, type JudgeResult } from '../../lib/judge';
import { useT, fmt } from '../../i18n';

// The decision model (the judge), configured where the other keys are.
// One switch with what it buys; when on, the app looks for a way to reach
// one — the OpenRouter access already saved counts — and checks that it
// answers; otherwise the provider inputs unfold: TypeSafe, Cloudflare, any
// self-hosted /v1/systemone, or the chat model as an uncalibrated stand-in.
// Off, every decision falls back to its rule.

const PROVIDERS: JudgeProviderId[] = ['openrouter', 'typesafe', 'cloudflare', 'custom', 'llm', 'off'];

export default function JudgeSettings() {
  const t = useT();
  const judgeCfg = useUiStore((s) => s.judge);
  const setJudge = useUiStore((s) => s.setJudge);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: true; r: JudgeResult } | { ok: false; error: string } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const storedKey = storedOpenRouterKey();
  const on = judgeCfg.provider !== 'off';
  const configured = judgeConfigured(judgeCfg);
  const effective = effectiveProvider(judgeCfg);
  const tripped = judgeTripped();

  const runTest = async (cfg = judgeCfg) => {
    setTesting(true); setTest(null);
    try { setTest({ ok: true, r: await judgeSelfTest(cfg) }); }
    catch (e) { setTest({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
    finally { setTesting(false); }
  };
  // a provider that is reachable in principle is checked once, so the row says whether it answers
  useEffect(() => {
    if (!on || !configured || test || testing) return;
    void runTest(judgeCfg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, configured, effective]);

  const field = (label: string, value: string, onChange: (v: string) => void, extra: { placeholder?: string; secret?: boolean; hint?: string } = {}) => (
    <label className="block">
      <span className="block text-control text-ink-faint mb-0.5">{label}</span>
      <input
        type={extra.secret ? 'password' : 'text'}
        value={value}
        onChange={(e) => { onChange(e.target.value); setTest(null); }}
        placeholder={extra.placeholder}
        spellCheck={false}
        autoComplete="off"
        className="w-full text-control font-mono bg-wash border border-line rounded-control px-2 py-1 focus:outline-none focus:border-accent/60"
      />
      {extra.hint && <span className="block text-control text-ink-faint mt-0.5">{extra.hint}</span>}
    </label>
  );
  const providerLabel = (p: JudgeProviderId) => t(`judge.provider.${p}` as 'judge.provider.none');
  const usingStored = effective === 'openrouter' && !judgeCfg.openrouterKey && !!storedKey;

  return (
    <div className="border border-line rounded-content px-3 py-2.5 bg-surface" data-judge-settings data-judge-on={on ? 'on' : 'off'}>
      <div className="flex items-center gap-2">
        <Scale size={14} strokeWidth={1.75} className="text-accent" />
        <span className="text-title font-semibold text-ink flex-1">{t('judge.title')}</span>
      </div>
      <p className="text-control text-ink-faint mt-1">{t('judge.oneLine')}</p>

      {(
        <div className="mt-2 space-y-2" data-judge-body>
          {/* what is in use, and whether it answers */}
          <div className="flex items-center gap-2 flex-wrap text-control">
            <span className="text-ink-muted" data-judge-effective={effective}>{usingStored ? t('judge.detected') : configured ? providerLabel(effective) : on ? t('judge.stateNoApi') : t('judge.stateOff')}</span>
            {!choosing && <button onClick={() => setChoosing(true)} className="text-accent hover:underline" data-judge-other>{t('judge.otherProvider')}</button>}
          </div>
          {(choosing || !configured) && (
            <label className="block">
              <span className="block text-control text-ink-faint mb-0.5">{t('judge.providerLabel')}</span>
              <select value={judgeCfg.provider === 'none' ? 'openrouter' : judgeCfg.provider} onChange={(e) => { setJudge({ provider: e.target.value as JudgeProviderId }); setTest(null); }} className="w-full bg-wash border border-line rounded-control px-2 py-1 text-control" data-judge-provider>
                {PROVIDERS.map((p) => <option key={p} value={p}>{providerLabel(p)}</option>)}
              </select>
            </label>
          )}
          {(choosing || !configured) && (
            <div className="space-y-2">
              {(judgeCfg.provider === 'openrouter' || judgeCfg.provider === 'none') && field(t('judge.key'), judgeCfg.openrouterKey || storedKey, (v) => setJudge({ openrouterKey: v, provider: 'openrouter' }), { secret: true, placeholder: 'sk-or-…', hint: usingStored ? t('judge.openrouterStored') : t('judge.openrouterHint') })}
              {judgeCfg.provider === 'typesafe' && field(t('judge.key'), judgeCfg.typesafeKey, (v) => setJudge({ typesafeKey: v }), { secret: true, hint: t('judge.typesafeHint') })}
              {judgeCfg.provider === 'cloudflare' && (<>
                {field(t('judge.account'), judgeCfg.cloudflareAccount, (v) => setJudge({ cloudflareAccount: v }))}
                {field(t('judge.token'), judgeCfg.cloudflareToken, (v) => setJudge({ cloudflareToken: v }), { secret: true, hint: t('judge.cloudflareHint') })}
              </>)}
              {judgeCfg.provider === 'custom' && (<>
                {field(t('judge.url'), judgeCfg.customUrl, (v) => setJudge({ customUrl: v }), { placeholder: 'http://127.0.0.1:8000/v1/systemone', hint: t('judge.urlHint') })}
                {field(t('judge.keyOptional'), judgeCfg.customKey, (v) => setJudge({ customKey: v }), { secret: true })}
              </>)}
              {judgeCfg.provider === 'llm' && <p className="text-control text-ink-faint">{t('judge.llmHint')}</p>}
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => void runTest()} disabled={testing || !configured} className="text-control px-3 py-1 rounded-control bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50 flex items-center gap-1.5" data-judge-test>
              {testing && <Loader2 size={12} className="animate-spin" />} {t('judge.test')}
            </button>
            {testing && !test && <span className="text-control text-ink-faint">{t('judge.checking')}</span>}
            {test && (test.ok
              ? <span className="text-control text-ink-muted font-mono" data-judge-test-result>{fmt(t('judge.available'), { model: test.r.model || providerLabel(test.r.provider), ms: test.r.ms, c: t(test.r.calibrated ? 'judge.calibrated' : 'judge.uncalibrated') })}</span>
              : <span className="text-control text-red-500" data-judge-test-result>{fmt(t('judge.unavailable'), { e: test.error })}</span>)}
            {tripped && <span className="text-control text-amber-600" data-judge-tripped>{fmt(t('judge.trippedNow'), { s: Math.max(1, Math.round((tripped.until - Date.now()) / 1000)) })}</span>}
          </div>
        </div>
      )}

    </div>
  );
}
