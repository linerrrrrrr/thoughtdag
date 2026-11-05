import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import '../index.css';
import '../components/ConversationSurface.css';
import '../components/focus-panel/FocusPanel.css';
import '../components/CanvasLayoutPanel.css';
import '../components/NodeTokenUsage.css';
import './style-guide.css';
import { StyleGuide } from './StyleGuide';

// This entry deliberately bypasses application boot, persistence, and bridges.
createRoot(document.getElementById('root')!).render(
  <StrictMode><StyleGuide /></StrictMode>,
);
