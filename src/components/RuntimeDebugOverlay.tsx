'use client';

import { useEffect, useState, useCallback } from 'react';
import { useQuest } from '@/context/QuestContext';

interface DebugLog {
  timestamp: string;
  type: 'request' | 'response' | 'state';
  endpoint?: string;
  data: any;
}

export function RuntimeDebugOverlay() {
  const { runtime } = useQuest();
  const [visible, setVisible] = useState(false);
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [expanded, setExpanded] = useState(false);

  const addLog = useCallback((log: DebugLog) => {
    setLogs(prev => [...prev.slice(-20), log]); // Keep last 20 logs
  }, []);

  // Intercept fetch calls to runtime API
  useEffect(() => {
    if (!visible) return;

    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const [url, options] = args;
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/api/runtime/')) {
        const endpoint = urlStr.split('/api/runtime/')[1]?.split('?')[0] || 'unknown';

        addLog({
          timestamp: new Date().toISOString().split('T')[1].slice(0, 8),
          type: 'request',
          endpoint,
          data: options?.body ? JSON.parse(options.body as string) : null
        });

        const response = await originalFetch(...args);
        const clonedResponse = response.clone();

        try {
          const data = await clonedResponse.json();
          addLog({
            timestamp: new Date().toISOString().split('T')[1].slice(0, 8),
            type: 'response',
            endpoint,
            data: {
              success: data.success,
              currentObjectId: data.snapshot?.me?.currentObjectId,
              visibleObjectIds: data.snapshot?.me?.visibleObjectIds,
              completedObjectIds: data.snapshot?.me?.completedObjectIds,
            }
          });
        } catch (e) {
          // Not JSON response
        }

        return response;
      }

      return originalFetch(...args);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [visible, addLog]);

  // Log state changes
  useEffect(() => {
    if (!visible || !runtime?.snapshot) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    addLog({
      timestamp: new Date().toISOString().split('T')[1].slice(0, 8),
      type: 'state',
      data: {
        currentObjectId: (runtime.snapshot.me as any).currentObjectId,
        visibleObjectIds: runtime.snapshot.me.visibleObjectIds,
        completedObjects: Array.from(runtime.completedObjects),
        nodes: runtime.snapshot.nodes,
        serverTime: runtime.snapshot.serverTime
      }
    });
  }, [visible, runtime?.snapshot?.me, runtime?.completedObjects, addLog]);

  const copyToClipboard = () => {
    const text = JSON.stringify({
      state: {
        currentObjectId: (runtime?.snapshot?.me as any)?.currentObjectId,
        visibleObjectIds: runtime?.snapshot?.me.visibleObjectIds,
        completedObjects: Array.from(runtime?.completedObjects || [])
      }, logs
    }, null, 2);

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(err => console.error('Failed to copy', err));
    } else {
      console.warn('Clipboard API not available');
    }
  };

  if (!visible) {
    return (
      <button
        onClick={() => setVisible(true)}
        style={{
          position: 'fixed',
          bottom: '80px',
          right: '10px',
          zIndex: 10000,
          background: 'rgba(0,0,0,0.7)',
          color: 'white',
          border: '1px solid #666',
          borderRadius: '4px',
          padding: '8px 12px',
          fontSize: '12px',
          fontFamily: 'monospace',
          cursor: 'pointer'
        }}
      >
        Debug
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: expanded ? '0' : 'auto',
        top: expanded ? '0' : 'auto',
        left: '0',
        right: '0',
        height: expanded ? '100vh' : '400px',
        zIndex: 10000,
        background: 'rgba(0,0,0,0.95)',
        color: '#0f0',
        fontFamily: 'monospace',
        fontSize: '11px',
        overflow: 'hidden', // Contain scroll to inner div
        display: 'flex',
        flexDirection: 'column',
        borderTop: '2px solid #0f0',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.5)'
      }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '10px',
        background: '#1a1a1a',
        borderBottom: '1px solid #333',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: '#333',
              color: '#0f0',
              border: '1px solid #0f0',
              borderRadius: '4px',
              padding: '4px 12px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 'bold'
            }}
          >
            {expanded ? '▼ Collapse' : '▲ Expand'}
          </button>
          <button
            onClick={() => setLogs([])}
            style={{
              background: '#333',
              color: '#0f0',
              border: '1px solid #0f0',
              borderRadius: '4px',
              padding: '4px 12px',
              cursor: 'pointer',
              fontSize: '11px'
            }}
          >
            Clear
          </button>
          <button
            onClick={copyToClipboard}
            style={{
              background: '#333',
              color: '#0ff', // Cyan for copy
              border: '1px solid #0ff',
              borderRadius: '4px',
              padding: '4px 12px',
              cursor: 'pointer',
              fontSize: '11px'
            }}
          >
            Copy JSON
          </button>
        </div>
        <button
          onClick={() => setVisible(false)}
          style={{
            background: '#333',
            color: '#f00',
            border: '1px solid #f00',
            borderRadius: '4px',
            padding: '4px 12px',
            cursor: 'pointer',
            fontSize: '11px'
          }}
        >
          ✕ Close
        </button>
      </div>

      <div style={{ overflow: 'auto', flex: 1, padding: '10px' }}>

        {/* Current State */}
        <div style={{ marginBottom: '12px', borderBottom: '1px solid #0f0', paddingBottom: '8px' }}>
          <div style={{ color: '#ff0', marginBottom: '4px' }}>📊 CURRENT STATE:</div>
          <div>currentObjectId: <span style={{ color: '#0ff' }}>{(runtime?.snapshot?.me as any)?.currentObjectId || 'null'}</span></div>
          <div>visibleObjectIds: <span style={{ color: '#0ff' }}>[{runtime?.snapshot?.me.visibleObjectIds?.join(', ') || ''}]</span></div>
          <div>completed: <span style={{ color: '#0ff' }}>{runtime?.completedObjects.size}</span></div>
          <div style={{ marginTop: '8px', color: '#ff0' }}>NODES ({Object.keys(runtime?.snapshot?.nodes || {}).length}):</div>
          <pre style={{ margin: 0, color: '#0f0', fontSize: '10px' }}>
            {JSON.stringify(
              Object.fromEntries(
                Object.entries(runtime?.snapshot?.nodes || {})
                  .filter(([_, node]) => node.status === 'completed' || node.status === 'unlocked')
                  .map(([id, node]) => [id, { status: node.status, outcome: node.outcome }])
              ),
              null, 2
            )}
          </pre>
        </div>

        {/* Logs */}
        <div>
          {logs.slice().reverse().map((log, idx) => (
            <div
              key={idx}
              style={{
                marginBottom: '8px',
                paddingBottom: '8px',
                borderBottom: '1px solid #333'
              }}
            >
              <div style={{
                color: log.type === 'request' ? '#ff0' :
                  log.type === 'response' ? '#0ff' : '#f0f'
              }}>
                [{log.timestamp}] {log.type.toUpperCase()}
                {log.endpoint && `: ${log.endpoint}`}
              </div>
              <pre style={{
                margin: '4px 0 0 0',
                fontSize: '10px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                color: '#0f0'
              }}>
                {JSON.stringify(log.data, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
