'use client';

import { useEffect, useRef, useState } from 'react';
import { useTeamSync } from '@/context/TeamSyncContext';
import { useQuestAudio } from '@/context/QuestAudioContext';
import { copyToClipboard } from '@/lib/copyToClipboard';
import styles from './RegistrationView.module.css';

interface RegistrationViewProps {
    onStart: (name: string, mode: 'solo' | 'team', teamCode?: string, action?: 'create' | 'join') => void;
    onCreateTeamCode?: (name: string) => Promise<string>;
}

export default function RegistrationView({ onStart, onCreateTeamCode }: RegistrationViewProps) {
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [mode, setMode] = useState<'solo' | 'team' | null>(null);
    const [teamAction, setTeamAction] = useState<'create' | 'join' | null>(null);
    const [teamCode, setTeamCode] = useState('');
    const [generatedCode, setGeneratedCode] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copyFeedback, setCopyFeedback] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
    const copyFeedbackTimeoutRef = useRef<number | null>(null);

    const teamSync = useTeamSync();
    const { unlockBackgroundAudio } = useQuestAudio();
    const audioUnlockInFlightRef = useRef<Promise<boolean> | null>(null);

    useEffect(() => {
        return () => {
            if (copyFeedbackTimeoutRef.current) {
                window.clearTimeout(copyFeedbackTimeoutRef.current);
                copyFeedbackTimeoutRef.current = null;
            }
        };
    }, []);

    const unlockAudio = () => {
        if (audioUnlockInFlightRef.current) return;
        audioUnlockInFlightRef.current = unlockBackgroundAudio().finally(() => {
            audioUnlockInFlightRef.current = null;
        });
    };

    const normalizeTeamCodeInput = (value: string) => {
        let normalized = value.trim();

        // Strip URL protocols (http://, https://, ws://, wss://)
        normalized = normalized.replace(/^(https?|wss?):\/\//i, '');

        // If it looks like a URL with a path, extract just the last segment
        // This handles cases like "quest-abc.pages.dev/team/QUEST-123" -> "QUEST-123"
        const pathMatch = normalized.match(/\/([^\/]+)$/);
        if (pathMatch) {
            normalized = pathMatch[1];
        }

        return normalized
            .toUpperCase()
            .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212\uFE63\uFF0D]/g, '-')
            .replace(/[\s\u200B\uFEFF]+/g, '');
    };

    const normalizedTeamCodeInput = normalizeTeamCodeInput(teamCode);
    const hasJoinedTeam =
        mode === 'team' &&
        teamAction === 'join' &&
        !!teamSync.session?.sessionId &&
        !!teamSync.teamCode &&
        teamSync.teamCode === normalizedTeamCodeInput;

    const isLeader =
        !!teamSync.session?.sessionId &&
        !!teamSync.team?.leaderSessionId &&
        teamSync.team.leaderSessionId === teamSync.session.sessionId;

    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

    const canProceed = firstName.trim().length > 0 && lastName.trim().length > 0 && (
        mode === 'solo' ||
        (mode === 'team' && teamAction === 'create' && !!generatedCode) ||
        (mode === 'team' && teamAction === 'join' && !hasJoinedTeam && teamCode.length >= 6)
    );

    const handleModeSelect = (selectedMode: 'solo' | 'team') => {
        setMode(selectedMode);
        setTeamAction(null);
        setGeneratedCode(null);
        setTeamCode('');
        setError(null);
    };

    const handleTeamActionSelect = (action: 'create' | 'join') => {
        setTeamAction(action);
        setGeneratedCode(null);
        setTeamCode('');
        setError(null);
    };

    const generateTeamCode = async () => {
        if (!firstName.trim() || !lastName.trim()) return;

        setIsGenerating(true);
        setError(null);

        try {
            if (!onCreateTeamCode) {
                throw new Error('Team creation not configured (missing NEXT_PUBLIC_QUEST_API_URL)');
            }
            const code = await onCreateTeamCode(fullName);
            setGeneratedCode(code);
        } catch (e: any) {
            console.error('Failed to create team', e);
            setError(e?.message || String(e));
        } finally {
            setIsGenerating(false);
        }
    };

    const handleStart = () => {
        if (!canProceed) return;

        // Unlock audio immediately on user interaction
        unlockAudio();

        if (mode === 'team' && teamAction === 'create' && generatedCode) {
            if (!isLeader || teamSync.connectionStatus !== 'connected') return;
            teamSync.startGame();
            return;
        }

        onStart(
            fullName,
            mode || 'solo',
            generatedCode || teamCode,
            mode === 'team' ? (teamAction || undefined) : undefined
        );
    };

    const activeTeamCode = hasJoinedTeam ? teamSync.teamCode : generatedCode;
    const lobbyMembers =
        activeTeamCode && teamSync.teamCode === activeTeamCode && teamSync.team?.members?.length ? teamSync.team.members : null;

    const handleCopyTeamCode = async (code: string | null) => {
        if (!code) return;
        try {
            await copyToClipboard(code);
            setCopyFeedback({ message: 'Copied', tone: 'success' });
        } catch {
            setCopyFeedback({ message: 'Copy failed', tone: 'error' });
        } finally {
            if (copyFeedbackTimeoutRef.current) window.clearTimeout(copyFeedbackTimeoutRef.current);
            copyFeedbackTimeoutRef.current = window.setTimeout(() => setCopyFeedback(null), 1500);
        }
    };

    return (
        <div
            className={styles.container}
            onPointerDownCapture={unlockAudio}
            onMouseDownCapture={unlockAudio}
            onTouchStartCapture={unlockAudio}
            onClickCapture={unlockAudio}
            onKeyDownCapture={unlockAudio}
        >
            {/* Portal rings */}
            <div className={`${styles['portal-ring']} ${styles.outer}`}></div>
            <div className={`${styles['portal-ring']} ${styles.inner}`}></div>

            {/* Letter card */}
            <div className={styles.letter}>
                {/* Wax seal */}
                <div className={styles['wax-seal']}>
                    <span className={styles['seal-text']}>1926</span>
                </div>

                {/* Header */}
                <div className={styles.header}>
                    <p className={styles['date-text']}>Esino Lario, 15 Luglio 1926</p>
                    <h1 className={styles.title}>Una Lettera dal Passato</h1>
                    <p className={styles.subtitle}>A Letter from the Past</p>
                </div>

                {/* Divider */}
                <div className={styles.divider}>
                    <span className={styles['divider-line']}></span>
                    <span className={styles['divider-icon']}>❧</span>
                    <span className={styles['divider-line']}></span>
                </div>

                {/* Intro */}
                <p className={styles['intro-text']}>
                    Caro discendente, I write to you across time itself.
                    The portal has found you. Will you answer the call?
                </p>

                {/* Name inputs */}
                <div className={styles['input-group']}>
                    <label className={styles.label}>Il Tuo Nome / Your Name</label>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <input
                            type="text"
                            className={styles.input}
                            placeholder="Nome / First Name"
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            style={{ flex: 1 }}
                        />
                        <input
                            type="text"
                            className={styles.input}
                            placeholder="Cognome / Last Name"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            style={{ flex: 1 }}
                        />
                    </div>
                </div>

                {/* Mode selection */}
                <div className={styles['input-group']}>
                    <label className={styles.label}>Come Viaggerai? / How Will You Travel?</label>
                    <div className={styles['mode-buttons']}>
                        <button
                            className={`${styles['mode-button']} ${mode === 'solo' ? styles.active : ''}`}
                            onClick={() => handleModeSelect('solo')}
                        >
                            <span className={styles['mode-icon']}>🚶</span>
                            <span className={styles['mode-label']}>Solo</span>
                            <span className={styles['mode-desc']}>Alone through time</span>
                        </button>
                        <button
                            className={`${styles['mode-button']} ${mode === 'team' ? styles.active : ''}`}
                            onClick={() => handleModeSelect('team')}
                        >
                            <span className={styles['mode-icon']}>👥</span>
                            <span className={styles['mode-label']}>Squadra</span>
                            <span className={styles['mode-desc']}>Travel together</span>
                        </button>
                    </div>
                </div>

                {/* Team section */}
                <div className={`${styles['team-section']} ${mode === 'team' ? styles.visible : ''}`}>
                    <div className={styles['team-actions']}>
                        <button
                            className={`${styles['team-action-button']} ${teamAction === 'create' ? styles.active : ''}`}
                            onClick={() => handleTeamActionSelect('create')}
                        >
                            Crea Squadra
                            <span className={styles['team-action-sub']}>Create new team</span>
                        </button>
                        <button
                            className={`${styles['team-action-button']} ${teamAction === 'join' ? styles.active : ''}`}
                            onClick={() => handleTeamActionSelect('join')}
                        >
                            Unisciti
                            <span className={styles['team-action-sub']}>Join existing team</span>
                        </button>
                    </div>

                    {/* Create panel */}
                    <div className={`${styles['team-create-panel']} ${teamAction === 'create' ? styles.visible : ''}`}>
                        {!generatedCode ? (
                            <button
                                className={styles['generate-button']}
                                onClick={generateTeamCode}
                                disabled={isGenerating || !firstName.trim() || !lastName.trim()}
                            >
                                {isGenerating ? 'Generating...' : 'Generate Team Code'}
                            </button>
                        ) : (
                            <div className={`${styles['code-display']} ${styles.visible}`}>
                                <p className={styles['code-label']}>Share this code with your companions:</p>
                                <div className={styles['code-box-row']}>
                                    <div className={styles['code-box']}>
                                        <span className={styles['code-text']}>{generatedCode}</span>
                                    </div>
                                    <button
                                        type="button"
                                        className={styles['copy-button']}
                                        onClick={() => void handleCopyTeamCode(generatedCode)}
                                    >
                                        Copy
                                    </button>
                                </div>
                                {teamAction === 'create' && copyFeedback && (
                                    <p
                                        className={`${styles['copy-feedback']} ${copyFeedback.tone === 'error' ? styles['copy-feedback-error'] : ''}`}
                                    >
                                        {copyFeedback.message}
                                    </p>
                                )}
                                <p className={styles['code-hint']}>They will need this to join your journey</p>
                            </div>
                        )}
                        {error && <p className={styles['code-hint']} style={{ color: '#ff6b6b' }}>{error}</p>}
                    </div>

                    {/* Join panel */}
                    <div className={`${styles['team-join-panel']} ${teamAction === 'join' ? styles.visible : ''}`}>
                        <label className={styles.label}>Codice Squadra / Team Code</label>
                        <input
                            type="text"
                            className={`${styles.input} ${styles['code-input']}`}
                            placeholder="GHIT-1926-XXXX"
                            maxLength={32}
                            value={teamCode}
                            onChange={(e) => setTeamCode(e.target.value.toUpperCase())}
                        />
                    </div>

                    {/* Lobby (Mocked to show 'You') */}
                    <div className={`${styles['lobby-section']} ${activeTeamCode ? styles.visible : ''}`}>
                        {activeTeamCode && (
                            <div className={styles['lobby-code-row']}>
                                <span className={styles['lobby-code-label']}>Team code:</span>
                                <span className={styles['lobby-code-text']}>{activeTeamCode}</span>
                                <button
                                    type="button"
                                    className={styles['lobby-copy-button']}
                                    onClick={() => void handleCopyTeamCode(activeTeamCode)}
                                >
                                    Copy
                                </button>
                            </div>
                        )}
                        <p className={styles['lobby-title']}>Compagni di Viaggio / Travel Companions</p>
                        <div className={styles['lobby-members']}>
                            {(lobbyMembers ?? [{ sessionId: 'you', playerName: fullName, ready: false, online: true }]).map((m: any) => (
                                <div key={m.sessionId} className={styles['lobby-member']}>
                                    <div className={styles['lobby-member-icon']}>{m.online ? '✓' : '…'}</div>
                                    <span>
                                        {m.playerName}{m.sessionId === teamSync.session?.sessionId ? ' (you)' : ''}{m.ready ? ' ✓ Ready' : ''}
                                    </span>
                                </div>
                            ))}
                        </div>
                        {(teamAction === 'join' || hasJoinedTeam) && copyFeedback && (
                            <p
                                className={`${styles['copy-feedback']} ${copyFeedback.tone === 'error' ? styles['copy-feedback-error'] : ''}`}
                            >
                                {copyFeedback.message}
                            </p>
                        )}
                        <p className={styles['lobby-waiting']}>
                            {hasJoinedTeam && !isLeader && !teamSync.team?.startedAt
                                ? 'Waiting for the team founder to start...'
                                : teamSync.connectionStatus === 'connected'
                                    ? 'Waiting for others to join...'
                                    : `Connecting… (${teamSync.connectionStatus})`}
                        </p>
                    </div>
                </div>

                {/* Divider */}
                <div className={styles.divider}>
                    <span className={styles['divider-line']}></span>
                    <span className={styles['divider-icon']}>⁂</span>
                    <span className={styles['divider-line']}></span>
                </div>

                {/* Start button */}
                {!(mode === 'team' && teamAction === 'join' && hasJoinedTeam) && (
                    <button
                        className={`${styles['start-button']} ${canProceed ? styles.enabled : ''}`}
                        onClick={handleStart}
                        disabled={
                            !canProceed ||
                            (mode === 'team' && teamAction === 'create' && (!isLeader || teamSync.connectionStatus !== 'connected'))
                        }
                    >
                        <span className={styles['start-button-text']}>
                            {mode === 'team' && teamAction === 'join'
                                ? 'Unisciti alla Squadra'
                                : mode === 'team' && teamAction === 'create'
                                    ? 'Inizia la Partita'
                                    : 'Attraversa il Portale'}
                        </span>
                        <span className={styles['start-button-sub']}>
                            {mode === 'team' && teamAction === 'join'
                                ? 'Join the Team'
                                : mode === 'team' && teamAction === 'create'
                                    ? 'Start the Game'
                                    : 'Enter the Portal'}
                        </span>
                    </button>
                )}

                {/* Signature */}
                <div className={styles.signature}>
                    <p className={styles['signature-text']}>Con speranza,</p>
                    <p className={styles['signature-name']}>~ Ghit ~</p>
                </div>

                {/* Corner decorations */}
                <div className={`${styles.corner} ${styles.tl}`}>❦</div>
                <div className={`${styles.corner} ${styles.tr}`}>❦</div>
                <div className={`${styles.corner} ${styles.bl}`}>❦</div>
                <div className={`${styles.corner} ${styles.br}`}>❦</div>
            </div>

            {/* Bottom hint */}
            <p className={styles['bottom-hint']}>
                The wedding is in 2 hours. Time is of the essence.
            </p>
        </div>
    );
}
