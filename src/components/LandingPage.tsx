import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, BookOpen, CircleHelp, KeyRound, Loader2 } from 'lucide-react';
import type { Attachment } from '../types';
import { useI18n, useT } from '../i18n';
import { FILE_INPUT_ACCEPT } from '../lib/attachments';
import { clipboardFilePaste } from '../lib/clipboard-files';
import type { PendingAttachmentFile } from '../lib/node-file-import';
import { availableExecutionModels, ensureAgentsFresh, useModels } from '../lib/use-models';
import { defaultModelId } from '../lib/model-sources';
import { modelExecutionKind } from '../lib/node-execution';
import type { AddQuestionOptions } from '../store/types';
import { startOpenRouterOAuth } from '../lib/openrouter-oauth';
import { useUiStore } from '../lib/ui-store';
import { isImeComposing } from '../utils';
import SearchToggles from './ui/SearchToggles';
import ModelPicker from './ui/ModelPicker';
import LandingExample from './LandingExample';
import { QuestionAttachmentTray, QuestionFilePicker } from './QuestionAttachments';
import './LandingPage.css';

interface LandingPageProps {
  question: string;
  onQuestionChange: (value: string) => void;
  attachments: Attachment[];
  pendingFiles: PendingAttachmentFile[];
  onAttach: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onUpdateAttachment: (id: string, patch: Partial<Attachment>) => void;
  onSubmit: (execution?: AddQuestionOptions['execution']) => void;
  onOpenDocuments: (files: File[]) => void;
  onOpenExample: () => void;
  draggingFiles: boolean;
}

export default function LandingPage({
  question, onQuestionChange, attachments, pendingFiles, onAttach, onRemoveAttachment, onUpdateAttachment,
  onSubmit, onOpenDocuments, onOpenExample, draggingFiles,
}: LandingPageProps) {
  const t = useT();
  const lang = useI18n(state => state.lang);
  const models = useModels();
  const selectedModel = useUiStore(state => state.selectedModel);
  // Agent discovery is lazy. Keep a saved agent selected while its catalog loads.
  const defaultModel = selectedModel && modelExecutionKind(selectedModel) !== 'api'
    ? selectedModel : defaultModelId(models, selectedModel);
  const [choice, setChoice] = useState<AddQuestionOptions['execution']>();
  const kind = choice?.executionKind ?? modelExecutionKind(defaultModel);
  const choices = availableExecutionModels(models, kind);
  const inheritedModel = choices.find(model => model.id === defaultModel)?.id ?? choices[0]?.id;
  const pinnedModel = choices.find(model => model.id === choice?.model)?.id;
  const model = pinnedModel ?? inheritedModel;
  const legacy = kind === 'legacy-agent';
  useEffect(() => {
    if (kind === 'codex') void ensureAgentsFresh();
  }, [kind]);
  const documentInput = useRef<HTMLInputElement>(null);
  const extracting = pendingFiles.length > 0 || attachments.some(file => file.isExtracting);
  const canSend = !!question.trim() && !extracting && (legacy || !!model);
  const submit = () => {
    if (canSend) onSubmit(legacy ? undefined : { executionKind: kind, model });
  };

  let modelControl;
  if (legacy) {
    modelControl = <span className="truncate text-control text-ink-muted">{defaultModel}</span>;
  } else if (choices.length) {
    modelControl = <ModelPicker key={kind} compact value={pinnedModel} execution={{ kind, models: choices, inheritedModel }}
      onChange={id => setChoice({ executionKind: kind, model: id })} />;
  } else if (kind === 'codex' && models?.agentsPending) {
    modelControl = <span className="text-control text-ink-muted" role="status">{t('connection.checking')}</span>;
  } else {
    modelControl = <button type="button" className="landing-connect text-control"
      onClick={() => useUiStore.getState().setApiKeyModalOpen(true, kind === 'api' ? 'providers' : 'agents')}>
      {t(kind === 'api' ? 'connection.api' : 'connection.agent')}
    </button>;
  }

  return (
    <main className="landing-page" data-landing-page aria-labelledby="landing-title">
      <div className="landing-layout">
        <div className="landing-workspace">
          <header className="landing-intro">
            <h1 id="landing-title" className="welcome-title" data-type-surface="entry-display">ThoughtDAG</h1>
            <p className="text-section">{t('landing.tagline')}</p>
          </header>

          <div className="landing-composer">
            <QuestionAttachmentTray scopeKey="landing" files={attachments} pendingFiles={pendingFiles}
              onSave={onUpdateAttachment} onRemove={onRemoveAttachment} />
            <textarea
              className="text-body" rows={3} autoFocus
              value={question} onChange={event => onQuestionChange(event.target.value)}
              aria-label={t('landing.placeholder')} placeholder={t('landing.placeholder')}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !isImeComposing(event)) {
                  event.preventDefault();
                  submit();
                }
              }}
              onPaste={event => {
                const { files, preventText } = clipboardFilePaste(event.clipboardData);
                if (files.length) {
                  if (preventText) event.preventDefault();
                  onAttach(files);
                }
              }}
            />
            <div className="landing-execution" data-landing-execution>
              <div className="landing-execution-options" role="group" aria-label={t('nodeExecution.type')}>
                {(['api', 'codex'] as const).map(option => (
                  <button key={option} type="button" className="text-control" data-node-execution-option={option}
                    aria-pressed={option === 'api' ? kind === 'api' : kind !== 'api'}
                    onClick={() => { if (kind !== option) setChoice({ executionKind: option }); }}>
                    {t(option === 'api' ? 'nodeExecution.api' : 'settings.agents')}
                  </button>
                ))}
              </div>
              {modelControl}
            </div>
            <div className="landing-composer-tools">
              <QuestionFilePicker onAttach={onAttach} />
              <SearchToggles draftExecution={{ kind, model: legacy ? defaultModel : model }} />
              <button type="button" className="landing-send text-control" onClick={submit} disabled={!canSend}>
                {extracting ? t('landing.extracting') : t('landing.send')}
                {extracting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <ArrowUp size={16} aria-hidden />}
              </button>
            </div>
          </div>

          <button type="button" className="landing-document" data-landing-document data-dragging={draggingFiles || undefined}
            onClick={() => documentInput.current?.click()}>
            <span className="landing-document-icon"><BookOpen size={22} strokeWidth={1.6} aria-hidden /></span>
            <span className="landing-document-copy">
              <strong className="text-title">{t('landing.docStart')}</strong>
              <span className="text-control">{t('landing.docFormats')}</span>
            </span>
            <ArrowRight className="landing-document-arrow" size={18} aria-hidden />
          </button>
          <input ref={documentInput} hidden type="file" multiple accept={FILE_INPUT_ACCEPT}
            onChange={event => { onOpenDocuments(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
        </div>

        <LandingExample onOpen={onOpenExample} />

        <footer className="landing-footer">
          {(!models || models.models.length === 0) && (
            <div className="landing-models text-control" data-quick-connect>
              <span className="landing-models-label"><KeyRound size={15} aria-hidden />{t('landing.quickTitle')}</span>
              {lang === 'zh' && (
                <button type="button" data-quick-zhipu onClick={() => {
                  useUiStore.getState().setApiKeyPresetHint('zhipu');
                  useUiStore.getState().setApiKeyModalOpen(true);
                }}>{t('landing.quickZhipu')}</button>
              )}
              <button type="button" data-quick-primary onClick={() => void startOpenRouterOAuth()}>{t('landing.quickOpenRouter')}</button>
              <button type="button" data-quick-subs onClick={() => useUiStore.getState().setApiKeyModalOpen(true)}>
                {t('landing.quickOther')}
              </button>
            </div>
          )}
          <button type="button" className="landing-tutorial text-control" data-landing-tutorial
            onClick={() => useUiStore.getState().setTutorialOpen(true)}>
            <CircleHelp size={16} strokeWidth={1.7} aria-hidden />{t('landing.howItWorks')}
          </button>
        </footer>
      </div>
    </main>
  );
}
