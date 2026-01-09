export function isQuestDebugEnabled(): boolean {
  // Enable via query param (?debug=1) or localStorage for deployed debugging.
  if (typeof window !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search);
      const qp =
        params.get('debug') ??
        params.get('questDebug') ??
        params.get('debugOverlay') ??
        params.get('debugLog');
      if (qp === '1' || qp === 'true' || qp === 'yes') return true;
    } catch {
      // ignore
    }

    try {
      const ls =
        window.localStorage.getItem('quest_debug') ??
        window.localStorage.getItem('quest_debug_overlay') ??
        window.localStorage.getItem('quest_debug_logs');
      if (ls === '1' || ls === 'true' || ls === 'yes') return true;
    } catch {
      // ignore
    }
  }

  return (
    process.env.NEXT_PUBLIC_QUEST_DEBUG === '1' ||
    process.env.NEXT_PUBLIC_DEBUG === '1'
  );
}

