'use client';

import React, { useEffect, useRef, useMemo } from 'react';
import styles from './StreamingText.module.css';
import type { Transcription } from '@/types/transcription';

interface StreamingTextProps {
    transcription: Transcription | null;
    currentTime: number;
    isPlaying: boolean;
    className?: string;
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
export function StreamingText({
    transcription,
    currentTime,
    isPlaying,
    className = ''
}: StreamingTextProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const currentWordRef = useRef<HTMLSpanElement>(null);
    const isUserScrollingRef = useRef(false);
    const scrollTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

    // Find current word index based on timestamp
    const currentWordIndex = useMemo(() => {
        if (!transcription?.words || transcription.words.length === 0) {
            return -1;
        }

        // Convert Decimal to number if needed (DynamoDB compatibility)
        const normalizeTime = (time: number | { toNumber?: () => number }): number => {
            if (typeof time === 'object' && time !== null && 'toNumber' in time) {
                return (time as { toNumber: () => number }).toNumber();
            }
            return Number(time);
        };

        return transcription.words.findIndex((word) => {
            const start = normalizeTime(word.start);
            const end = normalizeTime(word.end);
            return currentTime >= start && currentTime < end;
        });
    }, [transcription, currentTime]);

    // Calculate how many words to display (cumulative display)
    const visibleWordCount = useMemo(() => {
        if (!transcription?.words || transcription.words.length === 0) {
            return 0;
        }

        // If audio hasn't started or no current word, show no words yet
        if (currentWordIndex === -1 && currentTime === 0) {
            return 0;
        }

        // If we're past all words, show all words
        if (currentWordIndex === -1 && currentTime > 0) {
            return transcription.words.length;
        }

        // Show all words up to and including current word
        return currentWordIndex + 1;
    }, [transcription, currentWordIndex, currentTime]);

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

    return (
        <div className={`${styles.container} ${className}`} ref={containerRef}>
            <div className={styles.wordsContainer}>
                {transcription.words.slice(0, visibleWordCount).map((wordData, index) => {
                    const isCurrent = index === currentWordIndex;
                    const isPast = index < currentWordIndex;

                    return (
                        <span
                            key={`${index}-${wordData.word}`}
                            ref={isCurrent ? currentWordRef : null}
                            className={`
                                ${styles.word}
                                ${isCurrent ? styles.currentWord : ''}
                                ${isPast ? styles.pastWord : ''}
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
