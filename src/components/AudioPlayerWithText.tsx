'use client';

import React, { useState, useRef, useEffect } from 'react';
import { StreamingText } from './StreamingText';
import type { Transcription } from '@/types/transcription';

interface AudioPlayerWithTextProps {
    audioUrl: string;
    transcription: Transcription | null;
    className?: string;
}

/**
 * AudioPlayerWithText Component
 *
 * Complete example integration showing how to use StreamingText
 * with an HTML5 audio element.
 *
 * Features:
 * - HTML5 audio controls
 * - Synchronized streaming text display
 * - Automatic time tracking
 * - Play/pause state management
 */
export function AudioPlayerWithText({
    audioUrl,
    transcription,
    className = ''
}: AudioPlayerWithTextProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const handleTimeUpdate = () => {
            setCurrentTime(audio.currentTime);
        };

        const handlePlay = () => {
            setIsPlaying(true);
        };

        const handlePause = () => {
            setIsPlaying(false);
        };

        const handleEnded = () => {
            setIsPlaying(false);
        };

        const handleLoadedMetadata = () => {
            setDuration(audio.duration);
        };

        // Add event listeners
        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('play', handlePlay);
        audio.addEventListener('pause', handlePause);
        audio.addEventListener('ended', handleEnded);
        audio.addEventListener('loadedmetadata', handleLoadedMetadata);

        return () => {
            // Clean up event listeners
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('play', handlePlay);
            audio.removeEventListener('pause', handlePause);
            audio.removeEventListener('ended', handleEnded);
            audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        };
    }, []);

    return (
        <div className={`flex flex-col gap-4 ${className}`}>
            {/* Audio player */}
            <div className="w-full">
                <audio
                    ref={audioRef}
                    src={audioUrl}
                    controls
                    className="w-full"
                    preload="metadata"
                />
            </div>

            {/* Streaming text display */}
            <div className="flex-1 min-h-0">
                <StreamingText
                    transcription={transcription}
                    currentTime={currentTime}
                    isPlaying={isPlaying}
                    className="h-full"
                />
            </div>

            {/* Optional: Display current time and duration */}
            {duration > 0 && (
                <div className="text-sm text-gray-600 dark:text-gray-400 text-center">
                    {formatTime(currentTime)} / {formatTime(duration)}
                </div>
            )}
        </div>
    );
}

/**
 * Format time in MM:SS format
 */
function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
