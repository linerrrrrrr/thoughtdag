import { ArrowUpRight, BookOpen, GitFork, Network } from 'lucide-react';
import { useId } from 'react';
import { useT } from '../i18n';
import './LandingExample.css';

export default function LandingExample({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const questionId = useId();
  const offlineId = useId();
  return (
    <button type="button" onClick={onOpen} className="landing-example" data-landing-example
      aria-label={t('landing.loadExample')} aria-describedby={`${questionId} ${offlineId}`}>
      <span className="landing-example-sheet" aria-hidden="true">
        <span className="landing-example-caption text-control">
          <Network size={17} strokeWidth={1.7} />
          {t('landing.exampleLabel')}
        </span>
        <span className="landing-example-map">
          <span className="landing-example-node landing-example-root">
            <span id={questionId} className="landing-example-question text-heading">
              <span className="landing-example-book"><BookOpen size={19} strokeWidth={1.6} /></span>
              {t('landing.exampleQuestion')}
            </span>
            <span className="landing-example-answer text-control">{t('landing.exampleAnswer')}</span>
          </span>
          <svg className="landing-example-wires" viewBox="0 0 400 64" preserveAspectRatio="none" fill="none" aria-hidden="true">
            <path d="M160 0 V8 C160 34 94 25 94 57" />
            <path d="M160 0 V8 C160 39 306 16 306 57" />
          </svg>
          <span className="landing-example-leaves">
            <span className="landing-example-node landing-example-leaf">
              <span className="text-title">{t('landing.exampleConcept')}</span>
              <span className="landing-example-excerpt text-control">{t('landing.exampleConceptAnswer')}</span>
            </span>
            <span className="landing-example-node landing-example-leaf landing-example-alternate">
              <span className="text-title">{t('landing.exampleTool')}</span>
              <span className="landing-example-excerpt text-control">{t('landing.exampleToolAnswer')}</span>
            </span>
          </span>
        </span>
      </span>
      <span className="landing-example-footer">
        <span className="landing-example-action text-control">
          <GitFork size={16} strokeWidth={1.7} aria-hidden />
          {t('landing.loadExample')}
          <ArrowUpRight className="landing-example-open" size={16} strokeWidth={1.7} aria-hidden />
        </span>
        <span id={offlineId} className="landing-example-offline text-meta">{t('landing.exampleOffline')}</span>
      </span>
    </button>
  );
}
