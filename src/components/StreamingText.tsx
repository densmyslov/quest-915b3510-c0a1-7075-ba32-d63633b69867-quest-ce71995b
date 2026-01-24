'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import styles from './StreamingText.module.css';
import type { Transcription } from '@/types/transcription';
import { normalizeTime } from '@/lib/transcriptionUtils';
import { useDebugLog } from '@/context/DebugLogContext';
import { isQuestDebugEnabled } from '@/lib/debugFlags';

interface StreamingTextProps {
    transcription: Transcription | null;
    currentTime: number;
    audioDuration?: number;
    isPlaying: boolean;
    className?: string;
    showFutureWords?: boolean;
}

/**
 * StreamingText Component
 *
 * Displays synchronized text that follows audio playback, highlighting
 * words as they are spoken and automatically scrolling to keep the
 * current word visible.
 *
 * Features:
 * - Cumulative display: Words appear progressively
 * - Word synchronization: Current word highlighted by timestamp
 * - Auto-scroll: Keeps current word centered when content > 50% height
 * - User scroll detection: Pauses auto-scroll when user manually scrolls
 */
function upperBound(arr: number[], x: number): number {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] <= x) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

export function StreamingText({
    transcription,
    currentTime,
    audioDuration,
    isPlaying,
    className = '',
    showFutureWords = false
}: StreamingTextProps) {
    const { addLog } = useDebugLog();
    const containerRef = useRef<HTMLDivElement>(null);
    const currentWordRef = useRef<HTMLSpanElement>(null);
    const isUserScrollingRef = useRef(false);
    const scrollTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
    const lastDebugRef = useRef<{ key: string; idx: number; lastMs: number; lastVisible: number; hasWords: boolean } | null>(null);
    const debugEnabled = useMemo(() => isQuestDebugEnabled(), []);

    const hasWordLevel = !!transcription?.words && transcription.words.length > 0;

    const timing = useMemo(() => {
        if (!transcription?.words || transcription.words.length === 0) return null;

        const rawStarts = transcription.words.map((w) => normalizeTime(w.start));
        const rawEnds = transcription.words.map((w) => normalizeTime(w.end));

        // Validation: Check if we have usable timestamps.
        // If timestamps are missing/unparseable (NaN) or effectively all-zero, and we have a
        // valid audioDuration, we fallback to interpolation.
        const finiteEnds = rawEnds.filter((n) => Number.isFinite(n));
        const maxEnd = finiteEnds.length ? Math.max(...finiteEnds) : 0;
        const timedCount = rawStarts.reduce((acc, start, i) => {
            const end = rawEnds[i];
            if (!Number.isFinite(start) || !Number.isFinite(end)) return acc;
            return acc + (end - start > 0.01 ? 1 : 0);
        }, 0);

        const hasValidTimestamps = timedCount > 0 && maxEnd > 0.1; // at least 10ms span + 100ms max

        if (!hasValidTimestamps && audioDuration && audioDuration > 0) {
            // Interpolate!
            const wordCount = transcription.words.length;
            const durationPerWord = audioDuration / wordCount;
            return {
                starts: transcription.words.map((_, i) => i * durationPerWord),
                ends: transcription.words.map((_, i) => (i + 1) * durationPerWord)
            };
        }

        return {
            starts: rawStarts,
            ends: rawEnds
        };
    }, [transcription, audioDuration]);

    // Find current word index (highlight only when inside [start, end)).
    const currentWordIndex = useMemo(() => {
        if (!timing) return -1;
        const idx = upperBound(timing.starts, currentTime) - 1;
        if (idx < 0) return -1;
        if (currentTime < timing.ends[idx]) return idx;
        return -1;
    }, [currentTime, timing]);

    // Calculate how many words to display (cumulative display)
    const visibleWordCount = useMemo(() => {
        if (!timing) return 0;
        if (currentTime <= 0) return 0;
        // Show all words whose start time has been reached (handles gaps between words).
        return Math.max(0, Math.min(timing.starts.length, upperBound(timing.starts, currentTime)));
    }, [currentTime, timing]);

    useEffect(() => {
        if (!debugEnabled) return;
        const wordsLen = transcription?.words?.length ?? 0;
        const key = `${wordsLen}:${transcription?.fullText ? 'ft' : ''}`;
        const prev = lastDebugRef.current;
        if (!prev || prev.key !== key || prev.hasWords !== hasWordLevel) {
            lastDebugRef.current = {
                key,
                idx: prev?.idx ?? -999,
                lastMs: 0,
                lastVisible: prev?.lastVisible ?? -1,
                hasWords: hasWordLevel
            };
            addLog('info', '[StreamingText] inputs', {
                isPlaying,
                currentTime,
                hasWordLevel,
                wordsLen,
                hasFullText: !!transcription?.fullText
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debugEnabled, hasWordLevel, transcription, isPlaying]);

    useEffect(() => {
        if (!debugEnabled) return;
        if (!hasWordLevel) return;
        const now = typeof window !== 'undefined' ? window.performance.now() : Date.now();
        const prev = lastDebugRef.current;
        if (!prev) {
            lastDebugRef.current = { key: '', idx: currentWordIndex, lastMs: now, lastVisible: visibleWordCount, hasWords: hasWordLevel };
            return;
        }
        const shouldLog =
            currentWordIndex !== prev.idx ||
            visibleWordCount !== prev.lastVisible;
        if (!shouldLog) return;
        if (now - prev.lastMs < 750) return;
        prev.idx = currentWordIndex;
        prev.lastVisible = visibleWordCount;
        prev.lastMs = now;
        addLog('debug', '[StreamingText] progress', {
            isPlaying,
            currentTime,
            currentWordIndex,
            visibleWordCount
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debugEnabled, hasWordLevel, currentWordIndex, visibleWordCount, isPlaying, currentTime]);

    // Auto-scroll to current word
    useEffect(() => {
        if (!currentWordRef.current || !containerRef.current || !isPlaying) {
            return;
        }

        // Don't auto-scroll if user is manually scrolling
        if (isUserScrollingRef.current) {
            return;
        }

        const container = containerRef.current;
        const currentWord = currentWordRef.current;

        // Calculate 50% threshold for auto-scroll activation
        const containerHeight = container.clientHeight;
        const scrollThreshold = containerHeight * 0.5;

        // Check if content exceeds 50% of container height
        if (container.scrollHeight > scrollThreshold) {
            // Scroll to keep current word centered
            currentWord.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'nearest'
            });
        }
    }, [currentWordIndex, isPlaying]);

    // Detect user scrolling
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleScroll = () => {
            isUserScrollingRef.current = true;

            // Clear existing timeout
            if (scrollTimeoutRef.current) {
                clearTimeout(scrollTimeoutRef.current);
            }

            // Resume auto-scroll after 2 seconds of no user interaction
            scrollTimeoutRef.current = setTimeout(() => {
                isUserScrollingRef.current = false;
            }, 2000);
        };

        container.addEventListener('scroll', handleScroll, { passive: true });

        return () => {
            container.removeEventListener('scroll', handleScroll);
            if (scrollTimeoutRef.current) {
                clearTimeout(scrollTimeoutRef.current);
            }
        };
    }, []);

    // Fallback: display full text if no word-level transcription
    if (!transcription?.words || transcription.words.length === 0) {
        return (
            <div className={`${styles.container} ${className}`} ref={containerRef}>
                <p className={styles.fullText}>
                    {transcription?.fullText || 'No transcription available'}
                </p>
            </div>
        );
    }

    // Determine which words to render
    const wordsToRender = isPlaying || showFutureWords
        ? (showFutureWords ? transcription.words : transcription.words.slice(0, visibleWordCount))
        : [];

    // If showing future words, we render everything.
    // If NOT showing future words, we slice.
    // Actually, simpler logic:
    const renderedWords = showFutureWords ? transcription.words : transcription.words.slice(0, visibleWordCount);

    return (
        <div className={`${styles.container} ${className}`} ref={containerRef}>
            <div className={styles.wordsContainer}>
                {renderedWords.map((wordData, index) => {
                    const isCurrent = index === currentWordIndex;
                    const isPast = index < currentWordIndex;
                    const isFuture = index > currentWordIndex;

                    // Only anchor scroll if we are not showing future words (streaming view)
                    // OR if we are showing future words, still scroll to current.
                    const shouldAnchorScroll = isCurrent || (currentWordIndex === -1 && index === 0);

                    return (
                        <span
                            key={`${index}-${wordData.word}`}
                            ref={shouldAnchorScroll ? currentWordRef : null}
                            className={`
                                ${styles.word}
                                ${isCurrent ? styles.currentWord : ''}
                                ${isPast ? styles.pastWord : ''}
                                ${isFuture ? (showFutureWords ? styles.futureWord : '') : ''}
                            `}
                        >
                            {wordData.word}{' '}
                        </span>
                    );
                })}
            </div>
        </div>
    );
}
