'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './GameStatusPanel.module.css';

type GameStatusPanelProps = {
  votesFor: number;
  votesAgainst: number;
  totalPopulation?: number;
  gameStartTime: Date;
  gameDurationMinutes?: number;
  onTimeUp?: () => void;
  totalPoints?: number;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const pad2 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

export default function GameStatusPanel({
  votesFor,
  votesAgainst,
  totalPopulation,
  gameStartTime,
  gameDurationMinutes = 120,
  onTimeUp,
  totalPoints
}: GameStatusPanelProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const timeUpFiredRef = useRef(false);

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const total = useMemo(() => {
    const computed = Math.max(0, Math.floor(votesFor)) + Math.max(0, Math.floor(votesAgainst));
    if (typeof totalPopulation === 'number' && Number.isFinite(totalPopulation) && totalPopulation > 0) {
      return Math.max(Math.floor(totalPopulation), computed);
    }
    return computed;
  }, [votesFor, votesAgainst, totalPopulation]);

  const { remainingMs, remaining } = useMemo(() => {
    const durationMs = Math.max(0, Math.floor(gameDurationMinutes)) * 60_000;
    const startMs = gameStartTime instanceof Date ? gameStartTime.getTime() : Date.parse(String(gameStartTime));
    const elapsed = Math.max(0, nowMs - startMs);
    const rem = Math.max(0, durationMs - elapsed);
    const totalSeconds = Math.floor(rem / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { remainingMs: rem, remaining: { hours, minutes, seconds, totalSeconds } };
  }, [nowMs, gameStartTime, gameDurationMinutes]);

  useEffect(() => {
    if (!onTimeUp) return;
    if (remainingMs > 0) return;
    if (timeUpFiredRef.current) return;
    timeUpFiredRef.current = true;
    onTimeUp();
  }, [remainingMs, onTimeUp]);

  const isUrgent = remaining.totalSeconds > 0 && remaining.totalSeconds <= 30 * 60;
  const isCritical = remaining.totalSeconds > 0 && remaining.totalSeconds <= 10 * 60;

  const forClamped = Math.max(0, Math.floor(votesFor));
  const againstClamped = Math.max(0, Math.floor(votesAgainst));
  const pctFor = total > 0 ? (forClamped / total) * 100 : 0;
  const pctAgainst = total > 0 ? (againstClamped / total) * 100 : 0;

  const barFor = total > 0 && (forClamped > 0 || againstClamped > 0) ? clamp(pctFor, 0, 100) : 50;
  const barAgainst = total > 0 && (forClamped > 0 || againstClamped > 0) ? clamp(pctAgainst, 0, 100) : 50;

  return (
    <div className={styles.panel} aria-label="Game status">
      {/* If totalPoints is available, show it (metrics board style). Otherwise show voting section. */}
      <div className={styles.votingSection}>
        <div className={styles.votingTitle}>METRICHE</div>

        <div className={styles.votingBar} aria-label="Voting progress">
          <div className={styles.votesAgainst} style={{ width: `${barAgainst}%` }} />
          <div className={styles.votesFor} style={{ width: `${barFor}%` }} />
        </div>

        <div className={styles.voteStats}>
          <div className={styles.statAgainst}>
            <div className={styles.statValue}>{againstClamped}</div>
            <div className={styles.statLabel}>Contrari</div>
          </div>
          <div className={styles.statTotal}>{totalPoints ?? (total > 0 ? total : '—')}</div>
          <div className={styles.statFor}>
            <div className={styles.statValue}>{forClamped}</div>
            <div className={styles.statLabel}>Favore</div>
          </div>
        </div>
      </div>

      <div className={styles.divider} aria-hidden="true">
        <span className={styles.dividerOrnament}>❦</span>
      </div>

      <div
        className={[
          styles.timerSection,
          isCritical ? styles.critical : '',
          !isCritical && isUrgent ? styles.urgent : ''
        ].join(' ')}
      >
        <div className={styles.timerTitle}>TEMPO RESIDUO</div>
        <div className={styles.timerDisplay} aria-label="Time remaining">
          <div className={styles.timeBlock}>
            <div className={styles.timeValue}>{pad2(remaining.hours)}</div>
            <div className={styles.timeUnit}>ore</div>
          </div>
          <div className={styles.timeSeparator}>:</div>
          <div className={styles.timeBlock}>
            <div className={styles.timeValue}>{pad2(remaining.minutes)}</div>
            <div className={styles.timeUnit}>min</div>
          </div>
          <div className={styles.timeSeparator}>:</div>
          <div className={styles.timeBlock}>
            <div className={styles.timeValue}>{pad2(remaining.seconds)}</div>
            <div className={styles.timeUnit}>sec</div>
          </div>
        </div>
      </div>
    </div>
  );
}

