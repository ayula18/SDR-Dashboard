import { LoaderCircle, RefreshCw } from 'lucide-react';

/** First load only. Refetches keep the previous numbers on screen, dimmed. */
export function LoadingBlock({ label = 'Loading numbers', height }) {
  return (
    <div className="loading-block" style={height ? { minHeight: height } : undefined} role="status">
      <LoaderCircle className="spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'These numbers could not be loaded' }) {
  return (
    <div className="state error" role="alert">
      <h3>{title}</h3>
      <p>{error?.message || 'The server did not answer.'}</p>
      {onRetry && (
        <button type="button" className="btn btn-small" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action, inline = false }) {
  return (
    <div className={`state${inline ? ' inline' : ''}`}>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
