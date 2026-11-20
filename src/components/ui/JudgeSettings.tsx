import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useUiStore } from '../../lib/ui-store';
import { judgeSelfTest, storedOpenRouterKey, judgeConfigured, judgeTripped, effectiveProvider, type JudgeProviderId, type JudgeResult } from '../../lib/judge';
import { useT, fmt, type MessageKey } from '../../i18n';
import './JudgeSettings.css';

const PROVIDERS: JudgeProviderId[] = ['openrouter', 'typesafe', 'cloudflare', 'custom', 'llm'];
const fieldStyle = 'settings-field-control min-h-8 rounded-control border border-line bg-wash px-2 py-1 text-control text-ink focus-visible:outline-accent';

export default function JudgeSettings() {
  const enabled = useUiStore(state => state.judge.provider !== 'off');
  return <div hidden={!enabled} className="settings-section-divider" data-judge-settings data-judge-on={enabled ? 'on' : 'off'}>
    {enabled && <JudgeSources />}
  </div>;
}

function JudgeSources() {
  const t = useT();
  const formId = useId();
  const judgeCfg = useUiStore((s) => s.judge);
  const setJudge = useUiStore((s) => s.setJudge);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: true; r: JudgeResult } | { ok: false; error: string } | null>(null);
  const storedKey = storedOpenRouterKey();
  const configured = judgeConfigured(judgeCfg);
  const effective = effectiveProvider(judgeCfg);
  const tripped = judgeTripped();

  const runTest = async () => {
    setTesting(true); setTest(null);
    try {
      const r = await judgeSelfTest(judgeCfg);
      if (useUiStore.getState().judge === judgeCfg) setTest({ ok: true, r });
    } catch (e) {
      if (useUiStore.getState().judge === judgeCfg) setTest({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    finally { setTesting(false); }
  };

  const field = (label: MessageKey, value: string, onChange: (v: string) => void, extra: { placeholder?: string; secret?: boolean; hint?: string } = {}) => (
    <div className="settings-field-row">
      <div>
        <label htmlFor={`${formId}-${label}`} className="settings-field-title">{t(label)}</label>
        {extra.hint && <p id={`${formId}-${label}-hint`} className="settings-field-hint">{extra.hint}</p>}
      </div>
      <input
        id={`${formId}-${label}`}
        aria-describedby={extra.hint ? `${formId}-${label}-hint` : undefined}
        type={extra.secret ? 'password' : 'text'}
        value={value}
        onChange={(e) => { onChange(e.target.value); setTest(null); }}
        placeholder={extra.placeholder}
        spellCheck={false}
        autoComplete="off"
        className={`${fieldStyle} font-mono`}
      />
    </div>
  );
  const providerLabel = (p: JudgeProviderId) => t(`judge.provider.${p}`);
  const usingStored = effective === 'openrouter' && !judgeCfg.openrouterKey && !!storedKey;

  return (
    <div className="settings-field-section judge-fields" data-judge-body data-judge-effective={effective}>
      <div className="settings-field-row">
        <div>
          <label htmlFor={`${formId}-provider`} className="settings-field-title">{t('judge.providerLabel')}</label>
          {judgeCfg.provider === 'llm' && <p id={`${formId}-llm-hint`} className="settings-field-hint">{t('judge.llmHint')}</p>}
        </div>
        <select id={`${formId}-provider`} aria-describedby={judgeCfg.provider === 'llm' ? `${formId}-llm-hint` : undefined}
          value={judgeCfg.provider === 'none' ? 'openrouter' : judgeCfg.provider}
          onChange={(e) => { setJudge({ provider: e.target.value as JudgeProviderId }); setTest(null); }}
          className={fieldStyle} data-judge-provider>
          {PROVIDERS.map((p) => <option key={p} value={p}>{providerLabel(p)}</option>)}
        </select>
      </div>
      {(judgeCfg.provider === 'openrouter' || judgeCfg.provider === 'none') && field('judge.key', judgeCfg.openrouterKey || storedKey,
        (v) => setJudge({ openrouterKey: v, provider: 'openrouter' }), {
          secret: true, placeholder: 'sk-or-…', hint: usingStored ? t('judge.openrouterStored') : t('judge.openrouterHint'),
        })}
      {judgeCfg.provider === 'typesafe' && field('judge.key', judgeCfg.typesafeKey,
        (v) => setJudge({ typesafeKey: v }), { secret: true, hint: t('judge.typesafeHint') })}
      {judgeCfg.provider === 'cloudflare' && (<>
        {field('judge.account', judgeCfg.cloudflareAccount, (v) => setJudge({ cloudflareAccount: v }))}
        {field('judge.token', judgeCfg.cloudflareToken, (v) => setJudge({ cloudflareToken: v }), { secret: true, hint: t('judge.cloudflareHint') })}
      </>)}
      {judgeCfg.provider === 'custom' && (<>
        {field('judge.url', judgeCfg.customUrl, (v) => setJudge({ customUrl: v }), { placeholder: 'http://127.0.0.1:8000/v1/systemone', hint: t('judge.urlHint') })}
        {field('judge.keyOptional', judgeCfg.customKey, (v) => setJudge({ customKey: v }), { secret: true })}
      </>)}
      <div className="flex flex-wrap items-center justify-end gap-2 [overflow-wrap:anywhere]" aria-live="polite">
        {testing && !test && <span className="text-control text-ink-faint">{t('judge.checking')}</span>}
        {test && (test.ok
          ? <span className="text-control text-ink-muted font-mono" data-judge-test-result>{fmt(t('judge.available'), { model: test.r.model || providerLabel(test.r.provider), ms: test.r.ms, c: t(test.r.calibrated ? 'judge.calibrated' : 'judge.uncalibrated') })}</span>
          : <span className="text-control text-danger" data-judge-test-result>{fmt(t('judge.unavailable'), { e: test.error })}</span>)}
        {tripped && <span className="text-control text-amber-600" data-judge-tripped>{fmt(t('judge.trippedNow'), { s: Math.max(1, Math.round((tripped.until - Date.now()) / 1000)) })}</span>}
        <button type="button" onClick={() => void runTest()} disabled={testing || !configured} className="min-h-8 text-control px-3 py-1 rounded-control bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50 flex items-center gap-1.5" data-judge-test>
          {testing && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} {t('judge.test')}
        </button>
      </div>
    </div>
  );
}
