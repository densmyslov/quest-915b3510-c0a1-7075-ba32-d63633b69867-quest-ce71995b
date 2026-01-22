'use client';

import React from 'react';

import TimelineActionOverlay from '@/components/object-timeline/TimelineActionOverlay';
import TimelineArOverlay from '@/components/object-timeline/TimelineArOverlay';
import TimelineTextOverlay from '@/components/object-timeline/TimelineTextOverlay';
import TimelineChatOverlay from '@/components/object-timeline/TimelineChatOverlay';
import TimelineVideoOverlay from '@/components/object-timeline/TimelineVideoOverlay';
import TimelineDocumentOverlay from '@/components/object-timeline/TimelineDocumentOverlay';
import { COLORS } from '../components/MapStyles';

// Using 'any' for overlay states for now to ensure safe extraction without circular dependency or strict type issues initially.
// These can be typed more strictly in a future pass.
type Maybe<T> = T | null | undefined;

export type MapOverlaysProps = {
    // Action overlay
    timelineActionOverlay: Maybe<any>;
    completeTimelineAction: (payload?: any) => void;
    cancelTimelineAction: () => void;

    // AR overlay
    timelineArOverlay: Maybe<any>;
    completeTimelineAr: (payload?: any) => void;
    cancelTimelineAr: () => void;

    // Text overlay
    timelineTextOverlay: Maybe<any>;
    closeTimelineText: () => void;

    // Video overlay
    timelineVideoOverlay: Maybe<any>;
    closeTimelineVideo: () => void;

    // Chat overlay
    timelineChatOverlay: Maybe<any>;
    closeTimelineChat: () => void;

    // Audio sync
    audioCurrentTime: number;
    audioDuration: number;
    audioIsPlaying: boolean;

    // Document overlay
    timelineDocumentOverlay: Maybe<any>;
    closeTimelineDocument: () => void;
};

export default function MapOverlays(props: MapOverlaysProps) {
    const {
        timelineActionOverlay,
        completeTimelineAction,
        cancelTimelineAction,

        timelineArOverlay,
        completeTimelineAr,
        cancelTimelineAr,

        timelineTextOverlay,
        closeTimelineText,

        timelineVideoOverlay,
        closeTimelineVideo,

        timelineChatOverlay,
        closeTimelineChat,

        audioCurrentTime,
        audioDuration,
        audioIsPlaying,
        timelineDocumentOverlay,
        closeTimelineDocument
    } = props;

    // Common palette for overlays
    const palette = {
        gold: COLORS.gold,
        goldLight: COLORS.goldLight,
        parchment: COLORS.parchment
    };

    return (
        <>
            {/* Timeline action overlay */}
            {timelineActionOverlay ? (
                <TimelineActionOverlay
                    overlay={timelineActionOverlay}
                    onComplete={completeTimelineAction}
                    onCancel={cancelTimelineAction}
                    palette={palette}
                />
            ) : null}

            {/* Timeline AR overlay */}
            {timelineArOverlay ? (
                <TimelineArOverlay
                    overlay={timelineArOverlay}
                    onComplete={completeTimelineAr}
                    onCancel={cancelTimelineAr}
                    palette={palette}
                />
            ) : null}

            {/* Timeline text overlay */}
            {timelineTextOverlay ? (
                <TimelineTextOverlay
                    overlay={timelineTextOverlay}
                    onClose={closeTimelineText}
                    palette={palette}
                    currentTime={audioCurrentTime}
                    duration={audioDuration}
                    isPlaying={audioIsPlaying}
                />
            ) : null}

            {/* Timeline chat overlay */}
            {timelineChatOverlay ? (
                <TimelineChatOverlay
                    overlay={timelineChatOverlay}
                    onClose={closeTimelineChat}
                    palette={palette}
                />
            ) : null}

            {/* Timeline video overlay */}
            {timelineVideoOverlay ? (
                <TimelineVideoOverlay
                    overlay={timelineVideoOverlay}
                    onClose={closeTimelineVideo}
                    onEnded={closeTimelineVideo}
                    onError={() => closeTimelineVideo()}
                    palette={palette}
                />
            ) : null}

            {/* Timeline document overlay */}
            {timelineDocumentOverlay ? (
                <TimelineDocumentOverlay
                    overlay={timelineDocumentOverlay}
                    onClose={closeTimelineDocument}
                    palette={palette}
                />
            ) : null}
        </>
    );
}
