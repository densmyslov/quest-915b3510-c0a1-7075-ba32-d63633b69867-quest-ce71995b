/* eslint-disable react-hooks/refs */
'use client';

import React, { useMemo, useState, useEffect, type RefObject, type SyntheticEvent } from 'react';
import GameStatusPanel from './GameStatusPanel';
import { StreamingText } from '@/components/StreamingText';
import { formatTimestamp } from '@/lib/transcriptionUtils';
import type { Transcription } from '@/types/transcription';
import styles from './QuestMapOverlay.module.css';

export type QuestMapOverlayDocument = {
  id: string;
  title: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  body?: string;
};

type AudioEventHandler = (event: SyntheticEvent<HTMLAudioElement>) => void;

type QuestMapAudioPanel = {
  title: string;
  audioUrl: string;
  transcription: Transcription | null;
  mode: 'narration' | 'audio';
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
  audioRef: RefObject<HTMLAudioElement | null>;
  onTimeUpdate: AudioEventHandler;
  onPlay: AudioEventHandler;
  onPause: AudioEventHandler;
  onEnded: AudioEventHandler;
  onLoadedMetadata: AudioEventHandler;
  onError: AudioEventHandler;
};

type QuestTimelinePanelItem = {
  key: string;
  type: string;
  label: string;
  done: boolean;
  current: boolean;
  canOpen: boolean;
  gpsLocked?: boolean;
  gpsTriggerMode?: 'approach' | 'departure' | 'distance_range' | null;
  gpsDistanceMeters?: number | null;
};

type QuestTimelinePanel = {
  objectName: string;
  blockedByPuzzleId: string | null;
  items: QuestTimelinePanelItem[];
  onSkip: (key: string) => void | Promise<void>;
  onOpen: (key: string) => void;
};

type QuestMapOverlayProps = {
  documents?: QuestMapOverlayDocument[];
  votesFor?: number;
  votesAgainst?: number;
  totalPopulation?: number;
  mode?: 'play' | 'steps' | null;
  stepIndex?: number;
  stepTotal?: number;
  onSelectMode?: (mode: 'play' | 'steps') => void;
  onNextStep?: () => void;
  onPrevStep?: () => void;
  totalPoints?: number;
  audioPanel?: QuestMapAudioPanel;
  timelinePanel?: QuestTimelinePanel;
};

const QuestMapOverlay = React.memo(function QuestMapOverlay({
  documents = [],
  votesFor = 2,
  votesAgainst = 798,
  totalPopulation = 800,
  mode = null,
  stepIndex = 0,
  stepTotal = 0,
  onSelectMode,
  onNextStep,
  onPrevStep,
  totalPoints,
  audioPanel,
  timelinePanel
}: QuestMapOverlayProps) {
  const [folderOpen, setFolderOpen] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [isImageExpanded, setIsImageExpanded] = useState(false);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  const [gameStartTime, setGameStartTime] = useState<Date | null>(null);

  useEffect(() => {
    setGameStartTime(new Date());
  }, []);

  // Reset expanded state when closing modal
  useEffect(() => {
    if (!selectedDocId) {
      setIsImageExpanded(false);
    }
  }, [selectedDocId]);

  const selectedDoc = useMemo(
    () => documents.find((d) => d.id === selectedDocId) || null,
    [documents, selectedDocId]
  );

  const docCount = documents.length;
  const isStepsMode = mode === 'steps';
  const canNext = isStepsMode && stepTotal > 0 && stepIndex < stepTotal;



  return (
    <div className={styles.overlay} aria-hidden={false}>
      <div className={styles.topBar}>
        <div className={styles.folderContainer}>
          <button
            type="button"
            className={styles.folderButton}
            onClick={() => setFolderOpen((v) => !v)}
            aria-label={folderOpen ? 'Close documents' : 'Open documents'}
          >
            <div className={styles.folderIcon} aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.folderImage} src="/icons/dossier.png" alt="" />
              {docCount > 0 && <div className={styles.docCount}>{docCount}</div>}
            </div>
          </button>

          {folderOpen && (
            <div className={styles.folderExpanded} role="dialog" aria-label="Documents">
              <div className={styles.folderHeader}>
                <h3>Documenti</h3>
                <button
                  type="button"
                  className={styles.closeButton}
                  onClick={() => setFolderOpen(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <div className={styles.documentsList}>
                {documents.length === 0 ? (
                  <div className={styles.emptyMessage}>Nessun documento raccolto…</div>
                ) : (
                  documents.map((doc) => (
                    <button
                      key={doc.id}
                      type="button"
                      className={styles.documentItem}
                      onClick={() => setSelectedDocId(doc.id)}
                    >
                      <div className={styles.docThumbnail} aria-hidden="true">
                        {doc.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={doc.thumbnailUrl} alt="" />
                        ) : (
                          <div className={styles.docPlaceholder}>📜</div>
                        )}
                      </div>
                      <div className={styles.docInfo}>
                        <span className={styles.docTitle}>{doc.title}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
          <div className={styles.stepsContainer}>
            <div className={styles.stepsRow}>
              <button
                type="button"
                className={[styles.stepsButton, mode === 'play' ? styles.stepsButtonOn : ''].join(' ')}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectMode?.('play');
                }}
                onTouchStart={(event) => {
                  event.stopPropagation();
                }}
                aria-pressed={mode === 'play'}
                data-testid="mode-play"
              >
                Play mode
              </button>
              {(process.env.NEXT_PUBLIC_ENABLE_STEPS_MODE === 'true') && (
                <button
                  type="button"
                  className={[styles.stepsButton, mode === 'steps' ? styles.stepsButtonOn : ''].join(' ')}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectMode?.('steps');
                  }}
                  onTouchStart={(event) => {
                    event.stopPropagation();
                  }}
                  aria-pressed={mode === 'steps'}
                  data-testid="mode-steps"
                >
                  Steps mode
                </button>
              )}
            </div>

            {mode === null && (
              <div className={styles.stepsProgress}>Select a mode to begin</div>
            )}

            {isStepsMode && (
              <div className={styles.stepsRow}>
                <button
                  type="button"
                  className={styles.prevStepButton}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onPrevStep?.();
                  }}
                  onTouchStart={(event) => {
                    event.stopPropagation();
                  }}
                  disabled={!isStepsMode || stepIndex <= 0}
                  data-testid="steps-prev"
                >
                  Prev step
                </button>
                <button
                  type="button"
                  className={styles.nextStepButton}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onNextStep?.();
                  }}
                  onTouchStart={(event) => {
                    event.stopPropagation();
                  }}
                  disabled={!canNext}
                  data-testid="steps-next"
                >
                  Next step
                </button>
                <div className={styles.stepsProgress}>
                  {stepTotal > 0 ? `${Math.min(stepIndex, stepTotal)}/${stepTotal}` : '—'}
                </div>
              </div>
            )}
          </div>

          {isStepsMode && timelinePanel && (
            <div className={styles.timelinePanel} role="region" aria-label="Object timeline">
              <div className={styles.timelineHeader}>
                <div className={styles.timelineTitle}>Timeline</div>
                <div className={styles.timelineObjectName}>{timelinePanel.objectName}</div>
              </div>
              <div className={styles.timelineList}>
                {timelinePanel.items.map((item) => {
                  const rowClass = [
                    styles.timelineRow,
                    item.done ? styles.timelineRowDone : '',
                    item.current ? styles.timelineRowCurrent : '',
                  ]
                    .filter(Boolean)
                    .join(' ');

                  return (
                    <div key={item.key} className={rowClass}>
                      <div className={styles.timelineRowLabel}>
                        <span className={styles.timelineType}>{item.type}</span>
                        <span className={styles.timelineLabelText}>{item.label}</span>
                        {item.gpsLocked && (
                          <span style={{
                            marginLeft: '8px',
                            padding: '2px 6px',
                            background: 'rgba(201, 169, 97, 0.2)',
                            border: '1px solid #C9A961',
                            borderRadius: '3px',
                            fontSize: '10px',
                            color: '#C9A961',
                            fontWeight: 600
                          }}>
                            📍 {item.gpsTriggerMode === 'approach' ? 'Get closer' :
                              item.gpsTriggerMode === 'departure' ? 'Move away' :
                                'GPS locked'}
                          </span>
                        )}
                      </div>
                      <div className={styles.timelineRowActions}>
                        {item.canOpen && (item.current || item.done) && (
                          <button
                            type="button"
                            className={styles.timelineButton}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              timelinePanel.onOpen(item.key);
                            }}
                            onTouchStart={(event) => event.stopPropagation()}
                          >
                            {item.type === 'action' ? 'Start' : 'Open'}
                          </button>
                        )}

                      </div>
                    </div>
                  );
                })}
              </div>
              {timelinePanel.blockedByPuzzleId && (
                <div className={styles.timelineHint}>
                  Waiting for puzzle {timelinePanel.blockedByPuzzleId} to complete…
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={`${styles.statusPanelWrap} ${isPanelCollapsed ? styles.hidden : ''}`}>
        <div className={styles.statusPanelToggle}>
          <button onClick={() => setIsPanelCollapsed(prev => !prev)} className={styles.toggleButton}>
            {isPanelCollapsed ? '[+]' : '[-]'}
          </button>
        </div>
        <div className={styles.statusPanelContent} style={{ transform: 'scale(0.8)', transformOrigin: 'bottom left' }}>
          {gameStartTime && (
            <GameStatusPanel
              votesFor={votesFor}
              votesAgainst={votesAgainst}
              totalPopulation={totalPopulation}
              gameStartTime={gameStartTime}
              gameDurationMinutes={120}
              totalPoints={totalPoints}
            />
          )}
        </div>
      </div>


      {audioPanel && (
        <>
          <audio
            ref={audioPanel.audioRef}
            src={audioPanel.audioUrl || undefined}
            controls={false}
            preload="metadata"
            playsInline
            className={styles.hiddenAudioElement}
            onTimeUpdate={audioPanel.onTimeUpdate}
            onPlay={audioPanel.onPlay}
            onPause={audioPanel.onPause}
            onEnded={audioPanel.onEnded}
            onLoadedMetadata={audioPanel.onLoadedMetadata}
            onError={audioPanel.onError}
          />
          {audioPanel.mode === 'narration' && (
            <div
              className={`${styles.audioPanel} ${audioPanel.isCollapsed ? styles.audioPanelCollapsed : ''}`}
              role="dialog"
              aria-label={`Audio: ${audioPanel.title}`}
            >
              <div className={styles.audioHeader}>
                <div className={styles.audioHeaderText}>
                  <div className={styles.audioEyebrow}>Now Playing</div>
                  <div className={styles.audioTitle}>{audioPanel.title}</div>
                  <div className={styles.audioStatus}>
                    {audioPanel.isPlaying ? 'Playing' : 'Paused'}
                  </div>
                </div>
                <div className={styles.audioActions}>
                  <button
                    type="button"
                    className={styles.audioActionButton}
                    onClick={audioPanel.onToggleCollapsed}
                    aria-label={audioPanel.isCollapsed ? 'Expand audio panel' : 'Collapse audio panel'}
                  >
                    {audioPanel.isCollapsed ? 'Expand' : 'Collapse'}
                  </button>
                  <button
                    type="button"
                    className={styles.audioActionButton}
                    onClick={audioPanel.onClose}
                    aria-label="Close audio panel"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className={styles.audioBody}>
                <div className={styles.audioMeta}>
                  <span>{formatTimestamp(audioPanel.currentTime)}</span>
                  <span>{formatTimestamp(audioPanel.duration)}</span>
                </div>
                <StreamingText
                  transcription={audioPanel.transcription}
                  currentTime={audioPanel.currentTime}
                  audioDuration={audioPanel.duration}
                  isPlaying={audioPanel.isPlaying}
                  className={styles.audioTranscript}
                />
              </div>
            </div>
          )}
        </>
      )}


      {
        selectedDoc && (
          <div
            className={styles.docModal}
            role="dialog"
            aria-label={`Document: ${selectedDoc.title}`}
            onClick={() => setSelectedDocId(null)}
          >
            <div className={styles.docModalContent} onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setSelectedDocId(null)}
                aria-label="Close"
              >
                ×
              </button>
              <h2>{selectedDoc.title}</h2>
              {selectedDoc.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className={styles.docFullImage}
                  src={selectedDoc.imageUrl}
                  alt={selectedDoc.title}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsImageExpanded(true);
                  }}
                  style={{ cursor: 'zoom-in' }}
                />
              )}
              <p>{selectedDoc.body || '—'}</p>
            </div>
          </div>
        )
      }

      {/* Fullscreen Image Overlay */}
      {selectedDoc && isImageExpanded && selectedDoc.imageUrl && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9000,
            backgroundColor: 'rgba(0,0,0,0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out',
            animation: 'fadeIn 0.2s ease-out'
          }}
          onClick={(e) => {
            e.stopPropagation();
            setIsImageExpanded(false);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={selectedDoc.imageUrl}
            alt="Full size"
            style={{
              maxWidth: '95vw',
              maxHeight: '95vh',
              objectFit: 'contain',
              boxShadow: '0 0 20px rgba(0,0,0,0.5)'
            }}
          />
          <button
            onClick={() => setIsImageExpanded(false)}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'white',
              border: 'none',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              fontSize: '24px',
              cursor: 'pointer',
              color: 'black',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>
      )}
    </div >
  );
});

export default QuestMapOverlay;
