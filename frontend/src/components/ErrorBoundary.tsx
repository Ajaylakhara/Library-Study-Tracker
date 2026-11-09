import { Component, type ReactNode } from 'react';
import { useRouteError } from 'react-router-dom';

function Fallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ivory px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-gold font-serif text-3xl text-gold-dark">!</div>
      <h1 className="font-serif text-3xl font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-muted">The page hit an unexpected problem. Reloading usually fixes it.</p>
      <button onClick={() => window.location.assign('/')} className="min-h-12 rounded-xl bg-oxford px-6 font-semibold text-paper hover:bg-navy">
        Reload
      </button>
    </div>
  );
}

/** Router-level fallback (errorElement) */
export function RouteError() {
  const err = useRouteError();
  if (import.meta.env.DEV) console.error(err);
  return <Fallback />;
}

/** Catches render errors outside the router */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <Fallback /> : this.props.children;
  }
}
