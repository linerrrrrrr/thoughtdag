import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CircleHelp, KeyRound, Loader2, Send } from 'lucide-react';
import type { AgentTurnOptions, Attachment } from '../types';
import { useI18n, useT } from '../i18n';
import { FILE_INPUT_ACCEPT } from '../lib/attachments';
import { clipboardFilePaste } from '../lib/clipboard-files';
import type { PendingAttachmentFile } from '../lib/node-file-import';
import { draftExecutionModels, ensureAgentsFresh, useModels } from '../lib/use-models';
import { catalogModel, defaultModelId } from '../lib/model-sources';
import { runtimeOf } from '../lib/agents/agent-runtime';
import { modelExecutionKind, supportedAgentOptions } from '../lib/node-execution';
import type { AddQuestionOptions } from '../store/types';
import { startOpenRouterOAuth } from '../lib/openrouter-oauth';
import { useUiStore } from '../lib/ui-store';
import { isImeComposing } from '../utils';
import SearchToggles from './ui/SearchToggles';
import { DraftExecutionPicker } from './ui/ModelPicker';
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
  const [choice, setChoice] = useState<{ model: string; agentOptions?: AgentTurnOptions }>();
  const choices = draftExecutionModels(models);
  const inheritedModel = defaultModel ?? choices.find(candidate => modelExecutionKind(candidate.id) === 'api')?.id;
  const model = choice?.model ?? inheritedModel ?? undefined;
  const kind = modelExecutionKind(model);
  const active = catalogModel(choices, model);
  useEffect(() => {
    if (runtimeOf(model)) void ensureAgentsFresh();
  }, [model]);
  const documentInput = useRef<HTMLInputElement>(null);
  const extracting = pendingFiles.length > 0 || attachments.some(file => file.isExtracting);
  const canSend = !!question.trim() && !extracting && (!!active || (kind === 'legacy-agent' && !runtimeOf(model)));
  const submit = () => {
    if (!canSend || !model) return;
    if (kind === 'legacy-agent') onSubmit({ model });
    else onSubmit({ executionKind: kind, model: active?.id ?? model,
      agentOptions: kind === 'codex' ? supportedAgentOptions(choice?.agentOptions, active) : undefined });
  };

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
            <div className="landing-composer-tools">
              <QuestionFilePicker onAttach={onAttach} />
              <SearchToggles draftExecution={{ kind, model }} />
            </div>
            <div className="landing-composer-actions">
              <div className="landing-execution" data-landing-execution>
                <DraftExecutionPicker variant="landing" kind={kind} models={choices}
                  value={choice?.model} inheritedModel={inheritedModel ?? undefined} agentOptions={choice?.agentOptions}
                  onPick={id => setChoice(previous => ({ model: id,
                    agentOptions: modelExecutionKind(id) === 'codex'
                      ? supportedAgentOptions(previous?.agentOptions, catalogModel(choices, id)) : undefined }))}
                  onAgentOptionsChange={agentOptions => { if (model) setChoice({ model, agentOptions }); }} />
              </div>
              <button type="button" className="landing-send text-control" onClick={submit} disabled={!canSend}>
                {extracting ? t('landing.extracting') : t('landing.send')}
                {extracting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Send size={16} strokeWidth={1.75} aria-hidden />}
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
