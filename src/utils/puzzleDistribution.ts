export type PuzzleAssignment = {
  user_id: string;
  puzzle_id: string;
  status: "assigned";
  assigned_at: number;
  attempts: number;
};

export type DistributeObjectPuzzlesResult = {
  assignments: PuzzleAssignment[];
  selected_puzzle_ids: string[];
};

type Rng = () => number;

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleArray<T>(array: T[], rng: Rng): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export type DistributeObjectPuzzlesOptions = {
  seed?: string | number;
  nowMs?: number;
};

/**
 * Distribute puzzles to players for a specific object
 *
 * Rules:
 * - m <= n: Each player gets a unique puzzle (random selection)
 * - m > n: Cycle through all n puzzles, some players get duplicates
 */
export function distributeObjectPuzzles(
  object: { puzzles: Array<{ puzzle_id: string }> },
  players: string[],
  options: DistributeObjectPuzzlesOptions = {},
): DistributeObjectPuzzlesResult {
  const n = object.puzzles.length;
  const m = players.length;

  const nowMs = typeof options.nowMs === "number" ? options.nowMs : Date.now();
  const rng: Rng =
    typeof options.seed === "string"
      ? mulberry32(fnv1a32(options.seed))
      : typeof options.seed === "number"
        ? mulberry32(options.seed >>> 0)
        : Math.random;

  if (n === 0 || m === 0) return { assignments: [], selected_puzzle_ids: [] };

  let assignments: PuzzleAssignment[] = [];
  let selectedPuzzleIds: string[] = [];

  if (m <= n) {
    const shuffledPuzzles = shuffleArray([...object.puzzles], rng);
    const selectedPuzzles = shuffledPuzzles.slice(0, m);
    selectedPuzzleIds = selectedPuzzles.map((p) => p.puzzle_id);

    const shuffledPlayers = shuffleArray([...players], rng);

    assignments = shuffledPlayers.map((user_id, index) => ({
      user_id,
      puzzle_id: selectedPuzzles[index].puzzle_id,
      status: "assigned",
      assigned_at: nowMs,
      attempts: 0,
    }));
  } else {
    selectedPuzzleIds = object.puzzles.map((p) => p.puzzle_id);

    const shuffledPuzzles = shuffleArray([...object.puzzles], rng);
    const shuffledPlayers = shuffleArray([...players], rng);

    assignments = shuffledPlayers.map((user_id, index) => {
      const puzzleIndex = index % n;
      return {
        user_id,
        puzzle_id: shuffledPuzzles[puzzleIndex].puzzle_id,
        status: "assigned",
        assigned_at: nowMs,
        attempts: 0,
      };
    });
  }

  return {
    assignments,
    selected_puzzle_ids: selectedPuzzleIds,
  };
}

