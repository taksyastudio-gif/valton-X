import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loader } from '@monaco-editor/react';

import App from './App';
import './index.css';

document.title = 'Valton X – Browser-Native Web IDE';

loader.config({
  paths: {
    vs: '/monaco/vs',
  },
});

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error(
    'Valton X could not start because the root element is missing.',
  );
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);