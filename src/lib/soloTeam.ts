export const SOLO_TEAM_STORAGE_KEYS = {
  flag: 'quest_soloTeam',
  startedAt: 'quest_teamStartedAt',
} as const;

export function isSoloTeamSession(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(SOLO_TEAM_STORAGE_KEYS.flag) === '1';
}

export function getSoloTeamStartedAt(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(SOLO_TEAM_STORAGE_KEYS.startedAt);
}

