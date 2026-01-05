import type { QuestData } from '@/types/quest';
import questDataJson from '@/data/quest.json';
import { normalizeQuestData } from '@/lib/questDataUtils';

/**
 * Load quest data on the server side
 * In production, this could be loaded from a database or external source
 */
export function loadQuestData(): QuestData {
    return normalizeQuestData(questDataJson as any);
}
