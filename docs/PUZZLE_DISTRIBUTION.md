# Puzzle Distribution (Per Object, Per Team)

This doc describes a **legacy** puzzle distribution/linking mechanism based on `linked_objects` / `unlocksPuzzleId`.

As of the timeline-based puzzle system, the player app triggers puzzles via **object timelines** (add a `puzzle` item to an object's timeline). The map popup and object details page no longer surface puzzles via legacy links.

## Goals

- When a player opens an object (or taps it on the map), they see a **Play Puzzle** link **only for the puzzle assigned to them** for that object.
- For team play, puzzle distribution starts **only after the team founder clicks “Enter / Start”**.
- Assignment follows the exact rules:
  - `m <= n`: each of `m` players gets a **unique** puzzle selected randomly from `n`.
  - `m > n`: use **all `n`** puzzles and **cycle** through them, so some players receive duplicates.

## Definitions

- **Object puzzles (`n`)**: puzzles linked to a specific object.
- **Players (`m`)**: the player IDs participating in the distribution.
  - In team mode, the list is the team members present **at game start**.
  - In solo mode, the list is just the current session.

## Where does the app get puzzle + player inputs?

### Puzzles (quest content)

Puzzles come from `QuestContext` (`useQuest().data`), which is populated from the static quest bundle (`quest-app-template/src/data/quest.json`) in the app root layout.

### Players (session + team state)

- **Solo:** the current player ID is the locally stored `quest_sessionId` (session created during registration).
- **Team:** player IDs are the team members’ `sessionId`s received over WebSocket and stored in `TeamSyncContext` (`teamSync.team.members`).

These are the values used as `players` input to the distribution algorithm.

## Which puzzles belong to an object?

For a given object `obj`, the candidate puzzles are:

- Any puzzle whose `linked_objects` includes `obj.id`, OR
- The puzzle whose `id === obj.unlocksPuzzleId` (legacy linking)

This legacy lookup previously happened in:

- `quest-app-template/src/app/object/[id]/ObjectClient.tsx` (removed)
- `quest-app-template/src/components/QuestMap.tsx` (removed)

## When does distribution happen?

### Team mode

Distribution is **gated** by `team.startedAt`:

- Before `startedAt`: no per-player assignment is computed and the map does not show a play link (it shows a “waiting for founder” hint instead).
- After `startedAt`: assignments become deterministic and stable for all clients.

### Solo mode

Solo sessions are created on registration, so distribution can happen immediately once a `quest_sessionId` exists.

## Which players are included in team distribution?

Only members who joined **on or before** the start time are included:

- `joinedAt <= startedAt`

This is intentional so that “late joiners” don’t change assignments after the game has begun.

## The distribution algorithm (final result)

The canonical implementation is:

- `quest-app-template/src/utils/puzzleDistribution.ts`

It returns:

```ts
{
  selected_puzzle_ids: string[],
  assignments: Array<{
    user_id: string,
    puzzle_id: string,
    status: "assigned",
    assigned_at: number,
    attempts: number
  }>
}
```

### Rule behavior

- If `m <= n`:
  - randomly pick `m` unique puzzles from `n`
  - shuffle players
  - assign 1:1
- If `m > n`:
  - include all `n` puzzles in `selected_puzzle_ids`
  - shuffle puzzles + players
  - assign by cycling: `puzzleIndex = playerIndex % n`

## Determinism & fairness

Distribution is deterministic (so every client computes the same mapping) by using a stable seed:

- Team seed: `teamCode:startedAt:objectId`
- Solo seed: `solo:sessionId:objectId`

`startedAt` (team) is used as the `assigned_at` timestamp anchor so the assignment is stable across reloads/devices.

## How the UI uses the result

We compute “my assigned puzzle for this object” by running the algorithm and selecting the assignment where:

- `assignment.user_id === my sessionId`

Then we expose that puzzle via a link to:

- `/puzzle/[id]`

Places this is surfaced:

- Object details page: shows “Play Puzzle” for the assigned puzzle.
- Map popup: shows “Risolvi l’Enigma” for the assigned puzzle (or hides it before the team starts).

## Known limitations (current implementation)

- Client-side only: assignments are computed locally, not persisted server-side yet.
- Late joiners after `startedAt` are excluded from the distribution for consistency.
- If quest data links multiple puzzles to one object, only the candidate set is used; the per-player selection is based on the distribution rules above.
