import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { ErrorBoundary } from './chat/ErrorBoundary';
import { CustomizeProvider } from './lib/CustomizeContext';

const container = document.getElementById('root');
if (!container) throw new Error('root element missing');
createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <CustomizeProvider>
        <App />
      </CustomizeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
