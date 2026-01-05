'use client';

import React, { useState } from 'react';
import { useDebugLog } from '@/context/DebugLogContext';

export function DebugOverlay() {
    const { logs, clearLogs, isVisible, setIsVisible } = useDebugLog();
    const [minimized, setMinimized] = useState(false);

    if (!isVisible) {
        return null;
    }

    if (minimized) {
        return (
            <div className="fixed bottom-0 left-0 right-0 z-[9999] bg-gray-900 border-t border-gray-700 p-2 flex justify-between items-center text-white font-mono text-xs">
                <span>Debug Logs ({logs.length})</span>
                <div className="flex gap-2">
                    <button onClick={() => setMinimized(false)} className="px-2 py-1 bg-gray-700 rounded">Expand</button>
                    <button onClick={() => setIsVisible(false)} className="px-2 py-1 bg-gray-700 rounded">Hide</button>
                </div>
            </div>
        );
    }

    const copyLogs = () => {
        const text = logs.map(l => `[${l.timestamp}] ${l.level.toUpperCase()}: ${l.message} ${l.data || ''}`).join('\n');
        navigator.clipboard.writeText(text).then(() => alert('Logs copied!'));
    };

    return (
        <div className="fixed inset-x-0 bottom-0 h-[50vh] z-[9999] bg-gray-900/95 text-green-400 font-mono text-xs border-t-2 border-green-600 flex flex-col shadow-2xl">
            <div className="flex justify-between items-center p-2 bg-gray-800 border-b border-gray-700">
                <h3 className="font-bold text-white">Debug Console ({logs.length})</h3>
                <div className="flex gap-2">
                    <button onClick={copyLogs} className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-500">Copy</button>
                    <button onClick={clearLogs} className="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-600">Clear</button>
                    <button onClick={() => setMinimized(true)} className="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-600">_</button>
                    <button onClick={() => setIsVisible(false)} className="px-3 py-1 bg-red-900 text-red-200 rounded hover:bg-red-800">X</button>
                </div>
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-1">
                {logs.length === 0 && <div className="text-gray-500 italic">No logs yet...</div>}
                {logs.map((log) => (
                    <div key={log.id} className={`border-b border-gray-800 pb-1 break-all ${log.level === 'error' ? 'text-red-400' :
                            log.level === 'warn' ? 'text-yellow-400' :
                                'text-green-400'
                        }`}>
                        <span className="text-gray-500">[{log.timestamp}]</span>{' '}
                        <span className="font-bold">{log.level.toUpperCase()}:</span>{' '}
                        {log.message}
                        {log.data && (
                            <pre className="mt-1 ml-4 text-[10px] text-gray-400 overflow-x-auto whitespace-pre-wrap">
                                {log.data}
                            </pre>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
