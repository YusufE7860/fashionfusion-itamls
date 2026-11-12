import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './index.css';

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

// Stop the mouse wheel from silently changing <input type="number"> values
// while focused. CSS in index.css hides the spinner arrows; this handles the
// other half of the problem — operators have lost stock counts and prices to
// an accidental scroll. We blur the input so wheel scrolls the page instead.
document.addEventListener('wheel', (e) => {
  const el = document.activeElement as HTMLElement | null;
  if (el?.tagName === 'INPUT' && (el as HTMLInputElement).type === 'number') {
    el.blur();
  }
}, { passive: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
