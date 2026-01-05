'use client';

import { useEffect, useRef, useState } from 'react';
import { copyToClipboard } from '@/lib/copyToClipboard';
import { createTeam, joinTeam, QuestSession, useTeamWebSocket } from '@/lib/useTeamWebSocket';

export default function Registration() {
  const [name, setName] = useState('Player');
  const [teamCodeInput, setTeamCodeInput] = useState('');
  const [teamCode, setTeamCode] = useState<string | null>(null);
  const [session, setSession] = useState<QuestSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current) window.clearTimeout(copyFeedbackTimeoutRef.current);
    };
  }, []);

  const { team, connectionStatus, latency, setReady, startGame, leaveTeam, sendChat } = useTeamWebSocket(teamCode, session, {
    onError: (code, message) => setError(`${code}: ${message}`),
  });

  const onCreate = async () => {
    setError(null);
    const res = await createTeam(name);
    setSession(res.session);
    setTeamCode(res.teamCode);
  };

  const onJoin = async () => {
    setError(null);
    const res = await joinTeam(teamCodeInput, name);
    setSession(res.session);
    setTeamCode(res.teamCode);
  };

  if (teamCode && session) {
    return (
      <div className="p-4 space-y-3">
        <div className="text-sm">
          <div className="flex items-center gap-2">
            <div>Team: {teamCode}</div>
            <button
              type="button"
              className="px-2 py-1 rounded bg-gray-200 text-xs"
              onClick={() => {
                void (async () => {
                  try {
                    await copyToClipboard(teamCode);
                    setCopyFeedback('Copied');
                  } catch {
                    setCopyFeedback('Copy failed');
                  } finally {
                    if (copyFeedbackTimeoutRef.current) window.clearTimeout(copyFeedbackTimeoutRef.current);
                    copyFeedbackTimeoutRef.current = window.setTimeout(() => setCopyFeedback(null), 1500);
                  }
                })();
              }}
            >
              Copy
            </button>
            {copyFeedback && (
              <span className={`text-xs ${copyFeedback === 'Copy failed' ? 'text-red-600' : 'text-gray-500'}`}>
                {copyFeedback}
              </span>
            )}
          </div>
          <div>Status: {connectionStatus}</div>
          <div>Latency: {latency ?? '-'}ms</div>
          {error && <div className="text-red-500">{error}</div>}
        </div>

        <div className="space-x-2">
          <button className="px-3 py-2 rounded bg-gray-800 text-white" onClick={() => setReady(true)}>
            Ready
          </button>
          <button className="px-3 py-2 rounded bg-gray-800 text-white" onClick={startGame}>
            Start Game
          </button>
          <button className="px-3 py-2 rounded bg-gray-200" onClick={() => sendChat('Hello team!')}>
            Send Chat
          </button>
          <button className="px-3 py-2 rounded bg-gray-200" onClick={leaveTeam}>
            Leave
          </button>
        </div>

        <div className="text-sm">
          <div>Members: {team?.members.length ?? 0}</div>
          <ul className="list-disc pl-5">
            {(team?.members ?? []).map((m) => (
              <li key={m.sessionId}>
                {m.playerName} — {m.online ? 'Online' : 'Offline'}
                {m.ready ? ' ✓' : ''}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="space-y-2">
        <label className="block text-sm">Player name</label>
        <input className="border rounded px-3 py-2 w-full" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      {error && <div className="text-sm text-red-500">{error}</div>}

      <div className="space-x-2">
        <button className="px-3 py-2 rounded bg-gray-800 text-white" onClick={onCreate}>
          Create Team
        </button>
      </div>

      <div className="space-y-2">
        <label className="block text-sm">Join with team code</label>
        <input
          className="border rounded px-3 py-2 w-full"
          value={teamCodeInput}
          onChange={(e) => setTeamCodeInput(e.target.value)}
          placeholder="GHIT-1926-ABCD"
        />
        <button className="px-3 py-2 rounded bg-gray-800 text-white" onClick={onJoin}>
          Join Team
        </button>
      </div>
    </div>
  );
}
