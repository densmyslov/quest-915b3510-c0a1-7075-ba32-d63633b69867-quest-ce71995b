import dynamic from 'next/dynamic';
import QuestMapOverlay from '@/components/QuestMapOverlay';
import MapOverlays from '@/components/map/MapOverlays';
import { CompassControl } from '@/components/map/CompassControl';
import { COLORS } from '@/components/map/MapStyles';

const PuzzleClientOverlay = dynamic(() => import('@/app/puzzle/[id]/PuzzleClient'), {
    ssr: false,
    loading: () => <div className="h-full w-full flex items-center justify-center bg-black text-white">Loading Puzzle...</div>
});

type QuestUIOverlaysProps = {
    mapMode: string | null;
    currentItineraryStep: number;
    itineraryRange: { start: number; end: number };
    selectMapMode: (mode: 'play' | 'steps') => void;
    nextStep: () => void;
    prevStep: () => void;
    totalPointsAvailable: number;
    votesFor: number;
    votesAgainst: number;
    stepsTimelinePanel: any;
    data: any;
    getItineraryNumber: (obj: any) => number | null;
    audioPanelProps: any;
    collectedDocuments: any[];
    notification: string | null;
    timelineState: any; // timelineTextOverlay, etc.
    timelineHandlers: any; // closeTimelineText, etc.
    audioState: any; // audioCurrentTime, etc.
    audioControls: any; // cycleEffectPlaybackRate, etc.
    puzzleCloseConfirmation: boolean;
    setPuzzleCloseConfirmation: React.Dispatch<React.SetStateAction<boolean>>;
    gpsEnabled: boolean;
    toggleGPS: () => void;
    heading: number | null;
    isPlayMode: boolean;
    stepsMode: boolean;
};

export function QuestUIOverlays({
    mapMode,
    currentItineraryStep,
    itineraryRange,
    selectMapMode,
    nextStep,
    prevStep,
    totalPointsAvailable,
    votesFor,
    votesAgainst,
    stepsTimelinePanel,
    data,
    getItineraryNumber,
    audioPanelProps,
    collectedDocuments,
    notification,
    timelineState,
    timelineHandlers,
    audioState,
    audioControls,
    puzzleCloseConfirmation,
    setPuzzleCloseConfirmation,
    gpsEnabled,
    toggleGPS,
    heading,
    isPlayMode,
    stepsMode
}: QuestUIOverlaysProps) {

    return (
        <>
            <QuestMapOverlay
                mode={mapMode as any}
                stepIndex={currentItineraryStep}
                stepTotal={itineraryRange.end}
                onSelectMode={selectMapMode}
                onNextStep={nextStep}
                onPrevStep={prevStep}
                totalPoints={totalPointsAvailable}
                votesFor={votesFor}
                votesAgainst={votesAgainst}
                timelinePanel={(() => {
                    if (!stepsTimelinePanel) return undefined;
                    // Find the expected object for the current step to prevent stale timeline data
                    const expectedObj = data?.objects?.find((obj: any) => {
                        const num = getItineraryNumber(obj);
                        return num === currentItineraryStep;
                    });
                    // Only show timeline panel if it matches the current step's object
                    if (expectedObj && stepsTimelinePanel.objectId === expectedObj.id) {
                        return stepsTimelinePanel;
                    }
                    return undefined;
                })()}
                audioPanel={audioPanelProps}
                documents={collectedDocuments}
            />

            {/* Vignette Overlay for dramatic contrast */}
            <div style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 2000,
                background: `
                    radial-gradient(ellipse at center, transparent 40%, rgba(26, 21, 16, 0.3) 80%, rgba(26, 21, 16, 0.6) 100%),
                    linear-gradient(to bottom, rgba(26, 21, 16, 0.2) 0%, transparent 15%, transparent 85%, rgba(26, 21, 16, 0.25) 100%)
                `
            }} />

            {/* Telegram-style Notification */}
            {notification && (
                <div style={{
                    position: 'absolute',
                    top: '70px',
                    left: '50%',
                    zIndex: 5000,
                    padding: '14px 24px',
                    background: `linear-gradient(135deg, ${COLORS.parchment} 0%, ${COLORS.parchmentDark} 100%)`,
                    border: `2px solid ${COLORS.gold}`,
                    boxShadow: '0 8px 32px rgba(44, 24, 16, 0.3), inset 0 1px 0 rgba(255,255,255,0.5)',
                    maxWidth: '300px',
                    animation: 'telegramSlide 4s ease-in-out forwards'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                            width: '8px',
                            height: '8px',
                            background: COLORS.burgundy,
                            borderRadius: '50%',
                            boxShadow: `0 0 8px rgba(114, 47, 55, 0.6)`
                        }}></div>
                        <span style={{
                            fontFamily: "'Cinzel', serif",
                            color: COLORS.sepia,
                            fontSize: '13px',
                            fontWeight: 600,
                            letterSpacing: '0.5px'
                        }}>
                            {notification}
                        </span>
                    </div>
                    <div style={{
                        marginTop: '10px',
                        paddingTop: '10px',
                        borderTop: `1px dashed ${COLORS.gold}`,
                        fontSize: '10px',
                        color: '#8B7355',
                        fontStyle: 'italic',
                        textAlign: 'center'
                    }}>
                        — Messaggio dal Portale —
                    </div>
                </div>
            )}

            <MapOverlays
                timelineActionOverlay={timelineState.timelineActionOverlay}
                completeTimelineAction={timelineHandlers.completeTimelineAction}
                cancelTimelineAction={timelineHandlers.cancelTimelineAction}

                timelineTextOverlay={timelineState.timelineTextOverlay}
                closeTimelineText={timelineHandlers.closeTimelineText}

                timelineVideoOverlay={timelineState.timelineVideoOverlay}
                closeTimelineVideo={timelineHandlers.closeTimelineVideo}

                timelineChatOverlay={timelineState.timelineChatOverlay}
                closeTimelineChat={timelineHandlers.closeTimelineChat}

                audioCurrentTime={audioState.currentTime}
                audioDuration={audioState.duration}
                audioIsPlaying={audioState.isPlaying}

                timelineDocumentOverlay={timelineState.timelineDocumentOverlay}
                closeTimelineDocument={timelineHandlers.closeTimelineDocument}
            />

            {timelineState.timelinePuzzleOverlay ? (
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        zIndex: 9000,
                        background: '#000',
                    }}
                    role="dialog"
                    aria-label="Puzzle"
                    data-testid="timeline-puzzle-overlay"
                >
                    <button
                        type="button"
                        onClick={() => {
                            if (stepsMode) {
                                setPuzzleCloseConfirmation(true);
                            } else {
                                timelineHandlers.closeTimelinePuzzle();
                            }
                        }}
                        aria-label="Close puzzle"
                        style={{
                            position: 'absolute',
                            top: 12,
                            right: 12,
                            zIndex: 9100,
                            width: 44,
                            height: 44,
                            borderRadius: 9999,
                            border: '1px solid rgba(255,255,255,0.3)',
                            background: 'rgba(0,0,0,0.55)',
                            color: '#fff',
                            fontSize: 24,
                            lineHeight: '44px',
                            textAlign: 'center',
                            cursor: 'pointer'
                        }}
                    >
                        ×
                    </button>
                    <PuzzleClientOverlay
                        puzzleId={timelineState.timelinePuzzleOverlay.puzzleId}
                        objectId={timelineState.timelinePuzzleOverlay.objectId}
                        onClose={timelineHandlers.closeTimelinePuzzle}
                    />

                    {puzzleCloseConfirmation && (
                        <div style={{
                            position: 'absolute',
                            inset: 0,
                            zIndex: 9500,
                            background: 'rgba(0,0,0,0.85)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <div style={{
                                width: '90%',
                                maxWidth: '320px',
                                padding: '24px',
                                background: `linear-gradient(135deg, ${COLORS.parchment} 0%, ${COLORS.parchmentDark} 100%)`,
                                border: `2px solid ${COLORS.gold}`,
                                borderRadius: '2px',
                                boxShadow: '0 10px 40px rgba(0,0,0,0.8)',
                                textAlign: 'center',
                                color: COLORS.ink
                            }}>
                                <h3 style={{
                                    fontFamily: "'Cinzel', serif",
                                    color: COLORS.sepia,
                                    fontSize: '18px',
                                    marginBottom: '16px',
                                    fontWeight: 700
                                }}>Saltare il Puzzle?</h3>
                                <p style={{
                                    fontFamily: "'Crimson Text', serif",
                                    fontSize: '16px',
                                    marginBottom: '24px',
                                    lineHeight: '1.4'
                                }}>
                                    Se confermi, il puzzle verrà segnato come completato e potrai proseguire.
                                </p>
                                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                                    <button
                                        onClick={() => setPuzzleCloseConfirmation(false)}
                                        style={{
                                            padding: '10px 20px',
                                            background: 'transparent',
                                            border: `1px solid ${COLORS.sepia}`,
                                            color: COLORS.sepia,
                                            fontFamily: "'Cinzel', serif",
                                            fontWeight: 600,
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Annulla
                                    </button>
                                    <button
                                        onClick={async () => {
                                            setPuzzleCloseConfirmation(false);
                                            await timelineHandlers.completeTimelinePuzzle();
                                        }}
                                        style={{
                                            padding: '10px 20px',
                                            background: `linear-gradient(135deg, ${COLORS.gold} 0%, #b8860b 100%)`,
                                            border: 'none',
                                            color: '#fff',
                                            fontFamily: "'Cinzel', serif",
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            boxShadow: '0 4px 10px rgba(0,0,0,0.2)'
                                        }}
                                    >
                                        Conferma
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            ) : null}

            {isPlayMode && (
                <CompassControl
                    gpsEnabled={gpsEnabled}
                    onToggle={toggleGPS}
                    heading={heading}
                />
            )}

            {/* Effect Audio Speed Control - floating button when effect audio is playing */}
            {audioState?.isEffectPlaying && (
                <button
                    type="button"
                    onClick={() => audioControls?.cycleEffectPlaybackRate?.()}
                    style={{
                        position: 'absolute',
                        bottom: 100,
                        right: 16,
                        zIndex: 4000,
                        width: 56,
                        height: 56,
                        borderRadius: '50%',
                        background: `linear-gradient(135deg, ${COLORS.gold} 0%, #b8860b 100%)`,
                        border: `2px solid ${COLORS.parchment}`,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        fontFamily: "'Cinzel', serif",
                        fontSize: 16,
                        fontWeight: 700,
                        color: '#fff',
                        textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                    }}
                    aria-label={`Playback speed: ${audioState?.effectPlaybackRate ?? 1}x. Tap to change.`}
                >
                    {audioState?.effectPlaybackRate ?? 1}x
                </button>
            )}
        </>
    );
}
