import questData from '../data/quest.json';
import { parseLatLng } from './coordinates';
import { normalizeQuestData } from '../lib/questDataUtils';

// Simple test runner
const runValidation = () => {
    console.log("Running Quest Data Validation...");

    const normalizedData = normalizeQuestData(questData as any);
    const { objects, puzzles, map } = normalizedData;
    const errors: string[] = [];
    const objectIds = new Set<string>();
    const puzzleIds = new Set<string>();

    // 1. Validate Objects
    if (!Array.isArray(objects)) {
        errors.push("FAIL: 'objects' must be an array.");
    } else if (objects.length === 0) {
        console.warn("WARN: 'objects' array is empty. This might be intentional but is unusual.");
    } else {
        // Check for at least one object with valid coordinates
        const hasValidCoords = objects.some((obj: any) => {
            if (!obj.id) {
                errors.push("FAIL: Found object without an ID.");
                return false;
            }
            if (objectIds.has(obj.id)) {
                errors.push(`FAIL: Duplicate Object ID found: ${obj.id}`);
            }
            objectIds.add(obj.id);

            return !!parseLatLng(obj.coordinates);
        });

        if (!hasValidCoords) {
            errors.push("FAIL: No objects with valid coordinates found. Map will default to London.");
        }
    }

    // 2. Validate Puzzles
    if (!Array.isArray(puzzles)) {
        errors.push("FAIL: 'puzzles' must be an array.");
    } else {
        puzzles.forEach((puzzle: any) => {
            if (!puzzle.id) {
                errors.push("FAIL: Found puzzle without an ID.");
            } else {
                if (puzzleIds.has(puzzle.id)) {
                    errors.push(`FAIL: Duplicate Puzzle ID found: ${puzzle.id}`);
                }
                puzzleIds.add(puzzle.id);
            }
        });
    }

    // 3. Referential Integrity (Object -> Puzzle)
    if (Array.isArray(objects)) {
        objects.forEach((obj: any) => {
            if (obj.unlocksPuzzleId) {
                if (!puzzleIds.has(obj.unlocksPuzzleId)) {
                    errors.push(`FAIL: Object '${obj.id}' links to non-existent puzzleId: '${obj.unlocksPuzzleId}'`);
                }
            }
        });
    }

    // 4. Validate Map Center (Optional, as it can be derived)
    if (map && map.center) {
        const { lat, lng } = map.center;
        if (lat == null || lng == null) {
            // Not a hard fail if objects exist, but good to note
            console.warn("WARN: map.center is missing lat/lng.");
        }
    }

    if (errors.length > 0) {
        console.error("Validation Failed:");
        errors.forEach(e => console.error(e));
        process.exit(1);
    } else {
        console.log("PASS: Quest Data is valid.");
    }
};

runValidation();
