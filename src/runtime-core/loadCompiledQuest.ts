import type { CompiledQuestDefinition } from './compiledQuest';
import { assertValidCompiledQuestDefinition } from './validateCompiledQuest';

type CacheEntry = {
  loadedAtMs: number;
  def: CompiledQuestDefinition;
};

const compiledCache = new Map<string, CacheEntry>();

function cacheKey(questId: string, questVersion: string): string {
  return `${questId}@${questVersion}`;
}

function resolveBaseUrl(requestUrl?: string): string | null {
  const fromEnv =
    process.env.COMPILED_QUEST_BASE_URL ||
    process.env.NEXT_PUBLIC_COMPILED_QUEST_BASE_URL ||
    process.env.QUEST_API_URL ||
    process.env.NEXT_PUBLIC_QUEST_API_URL ||
    process.env.NEXT_PUBLIC_API_URL;

  if (fromEnv && fromEnv.trim().length) return fromEnv.replace(/\/+$/, '');
  if (!requestUrl) return null;
  try {
    return new URL(requestUrl).origin;
  } catch {
    return null;
  }
}

export async function loadCompiledQuestDefinition(params: {
  questId: string;
  questVersion: string;
  requestUrl?: string;
  maxAgeMs?: number;
}): Promise<CompiledQuestDefinition> {
  const { questId, questVersion } = params;
  const maxAgeMs = typeof params.maxAgeMs === 'number' ? Math.max(0, params.maxAgeMs) : 5 * 60 * 1000;
  const key = cacheKey(questId, questVersion);

  const now = Date.now();
  const cached = compiledCache.get(key);
  if (cached && now - cached.loadedAtMs <= maxAgeMs) return cached.def;

  const base = resolveBaseUrl(params.requestUrl);
  if (!base) {
    throw new Error('Unable to resolve base URL for compiled quest definition fetch');
  }

  const url = `${base}/compiled/${encodeURIComponent(questId)}@${encodeURIComponent(questVersion)}.json`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to load compiled quest definition: HTTP ${res.status} ${res.statusText} ${text}`.trim());
  }

  const json = (await res.json()) as unknown;
  assertValidCompiledQuestDefinition(json);

  compiledCache.set(key, { loadedAtMs: now, def: json });
  return json;
}

export function clearCompiledQuestDefinitionCache() {
  compiledCache.clear();
}

