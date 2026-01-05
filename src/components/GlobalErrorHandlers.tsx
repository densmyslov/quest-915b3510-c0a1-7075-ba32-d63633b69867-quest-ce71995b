'use client';

import { useEffect } from 'react';
import { useDebugLog } from '@/context/DebugLogContext';

function toErrorDetails(value: unknown) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack ?? null };
  }
  if (typeof value === 'string') return { message: value };
  if (value === null) return { message: 'null' };
  if (value === undefined) return { message: 'undefined' };
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return { message: String(value) };
  }
  return { message: 'Non-Error rejection', valueType: typeof value };
}

export function GlobalErrorHandlers() {
  const { addLog } = useDebugLog();

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      addLog('error', 'Unhandled window error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: toErrorDetails(event.error),
      });
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      addLog('error', 'Unhandled promise rejection', {
        reason: toErrorDetails(event.reason),
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [addLog]);

  return null;
}

