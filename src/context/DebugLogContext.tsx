'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
    id: string;
    timestamp: string;
    level: LogLevel;
    message: string;
    data?: any;
}

interface DebugLogContextType {
    logs: LogEntry[];
    addLog: (level: LogLevel, message: string, data?: any) => void;
    clearLogs: () => void;
    isVisible: boolean;
    setIsVisible: (visible: boolean) => void;
}

const DebugLogContext = createContext<DebugLogContextType | null>(null);

export function useDebugLog() {
    const context = useContext(DebugLogContext);
    if (!context) {
        // Return a dummy implementation if used outside provider
        return {
            logs: [],
            addLog: () => { },
            clearLogs: () => { },
            isVisible: false,
            setIsVisible: () => { }
        };
    }
    return context;
}

export function DebugLogProvider({ children }: { children: React.ReactNode }) {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [isVisible, setIsVisible] = useState(false);

    const safeStringify = useCallback((value: unknown) => {
        if (typeof value === 'string') return value;
        const seen = new WeakSet<object>();
        try {
            return JSON.stringify(
                value,
                (_key, val) => {
                    if (!val || typeof val !== 'object') return val;
                    if (seen.has(val)) return '[Circular]';
                    seen.add(val);
                    return val;
                },
                2
            );
        } catch {
            try {
                return String(value);
            } catch {
                return '[Unserializable]';
            }
        }
    }, []);

    const addLog = useCallback((level: LogLevel, message: string, data?: any) => {
        const entry: LogEntry = {
            id: Math.random().toString(36).substring(2, 9),
            timestamp: new Date().toLocaleTimeString(),
            level,
            message,
            data: data === undefined ? undefined : safeStringify(data)
        };

        // Also log to browser console
        const consoleArgs = [`[${level.toUpperCase()}] ${message}`, data].filter(Boolean);
        if (level === 'error') console.error(...consoleArgs);
        else if (level === 'warn') console.warn(...consoleArgs);
        else console.log(...consoleArgs);

        setLogs(prev => [...prev.slice(-99), entry]); // Keep last 100 logs
    }, [safeStringify]);

    const clearLogs = useCallback(() => setLogs([]), []);

    return (
        <DebugLogContext.Provider value={{ logs, addLog, clearLogs, isVisible, setIsVisible }}>
            {children}
        </DebugLogContext.Provider>
    );
}
