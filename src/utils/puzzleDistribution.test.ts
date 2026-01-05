import assert from "node:assert/strict";
import { distributeObjectPuzzles } from "./puzzleDistribution";

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

{
  const object = { puzzles: [{ puzzle_id: "p1" }, { puzzle_id: "p2" }, { puzzle_id: "p3" }, { puzzle_id: "p4" }] };
  const players = ["a", "b", "c"];

  const r1 = distributeObjectPuzzles(object, players, { seed: "seed-1", nowMs: 123 });
  const r2 = distributeObjectPuzzles(object, players, { seed: "seed-1", nowMs: 999 });

  assert.equal(r1.assignments.length, 3);
  assert.equal(r1.selected_puzzle_ids.length, 3);
  assert.equal(unique(r1.selected_puzzle_ids).length, 3);
  assert.deepEqual(r1.selected_puzzle_ids, r2.selected_puzzle_ids);
  assert.deepEqual(
    r1.assignments.map((a) => ({ user_id: a.user_id, puzzle_id: a.puzzle_id })),
    r2.assignments.map((a) => ({ user_id: a.user_id, puzzle_id: a.puzzle_id })),
  );
}

{
  const object = { puzzles: [{ puzzle_id: "p1" }, { puzzle_id: "p2" }, { puzzle_id: "p3" }, { puzzle_id: "p4" }] };
  const players = ["a", "b", "c", "d", "e", "f"];

  const r = distributeObjectPuzzles(object, players, { seed: "seed-2", nowMs: 123 });
  assert.equal(r.assignments.length, 6);
  assert.deepEqual(r.selected_puzzle_ids, ["p1", "p2", "p3", "p4"]);

  const assignedPuzzleIds = r.assignments.map((a) => a.puzzle_id);
  assert.equal(unique(assignedPuzzleIds).length, 4);
  for (const pid of r.selected_puzzle_ids) {
    assert.ok(assignedPuzzleIds.includes(pid));
  }
}

{
  const r = distributeObjectPuzzles({ puzzles: [] }, ["a"], { seed: "x" });
  assert.deepEqual(r, { assignments: [], selected_puzzle_ids: [] });
}

console.log("PASS: puzzleDistribution");

