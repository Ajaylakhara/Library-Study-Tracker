import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import './index.css';
import { store } from './store/store';
import { App } from './App';
import { ToastHost } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Provider store={store}>
        <App />
        <ToastHost />
      </Provider>
    </ErrorBoundary>
  </StrictMode>
);
