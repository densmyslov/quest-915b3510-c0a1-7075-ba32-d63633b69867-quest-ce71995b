import type { QuestData, QuestObject, QuestPuzzle } from '@/types/quest';

const readString = (value: unknown): string | null => {
    if (typeof value === 'string') return value.trim();
    if (value && typeof value === 'object') {
        const candidate = (value as { S?: unknown; s?: unknown }).S ?? (value as { s?: unknown }).s;
        if (typeof candidate === 'string') return candidate.trim();
    }
    return null;
};

const normalizeList = <T>(value: unknown): T[] => {
    if (Array.isArray(value)) return value as T[];
    if (value && typeof value === 'object') return Object.values(value as Record<string, T>);
    return [];
};

export const getPuzzleId = (puzzle: QuestPuzzle | Record<string, unknown>): string | null => {
    const raw =
        (puzzle as { id?: unknown }).id ??
        (puzzle as { puzzleId?: unknown }).puzzleId ??
        (puzzle as { puzzle_id?: unknown }).puzzle_id ??
        (puzzle as { puzzleID?: unknown }).puzzleID;
    return readString(raw);
};

export const normalizeQuestData = (data: QuestData): QuestData => {
    const puzzles = normalizeList<QuestPuzzle>(data.puzzles).map((puzzle) => {
        const normalizedId = getPuzzleId(puzzle);
        if (!normalizedId || puzzle.id === normalizedId) return puzzle;
        return { ...puzzle, id: normalizedId };
    });

    let objects: QuestObject[] = [];
    if (Array.isArray(data.objects)) {
        objects = data.objects as QuestObject[];
    } else if (data.objects && typeof data.objects === 'object') {
        // Handle dictionary format (compiled.json)
        objects = Object.entries(data.objects as Record<string, Omit<QuestObject, 'id'>>).map(([id, obj]) => ({
            id,
            ...obj
        } as QuestObject));
    }

    // Handle Compiled Format -> Source Format conversion
    let finalPuzzles = puzzles;
    if ((data as any).puzzles && !Array.isArray((data as any).puzzles)) {
        // Compiled puzzles are a map, convert to array
        finalPuzzles = Object.values((data as any).puzzles);
    }

    const finalMap = (data as any).map || (data as any).quest?.map || { center: { lat: 0, lng: 0 }, zoom: 1 };
    const finalMetadata = (data as any).metadata || (data as any).quest || { id: 'unknown', name: 'Unknown' };

    return {
        ...data,
        quest: finalMetadata,
        map: finalMap,
        objects,
        puzzles: finalPuzzles
    } as unknown as QuestData;
};
