import type { QuestData, QuestObject, QuestPuzzle } from '@/types/quest';

/**
 * Server-side validation and anti-cheat utilities
 */

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 */
function calculateDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;

    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

/**
 * Validate that timestamp is reasonable (not too far in past or future)
 */
export function validateTimestamp(timestamp: string): boolean {
    const now = Date.now();
    const eventTime = new Date(timestamp).getTime();

    // Allow timestamps within 1 hour in the past or 5 minutes in the future
    const maxPastMs = 60 * 60 * 1000; // 1 hour
    const maxFutureMs = 5 * 60 * 1000; // 5 minutes

    const diff = now - eventTime;

    return diff >= -maxFutureMs && diff <= maxPastMs;
}

/**
 * Validate that object exists in quest data
 */
export function validateObjectExists(
    questData: QuestData,
    objectId: string
): QuestObject | null {
    const object = questData.objects.find(obj => obj.id === objectId);
    return object || null;
}

/**
 * Validate that puzzle exists in quest data
 */
export function validatePuzzleExists(
    questData: QuestData,
    puzzleId: string
): QuestPuzzle | null {
    const puzzle = questData.puzzles.find(p => p.id === puzzleId);
    return puzzle || null;
}

/**
 * Validate player is within proximity of object
 * Returns true if player location is within object's trigger radius
 */
export function validateProximity(
    object: QuestObject,
    playerLat: number,
    playerLng: number
): { valid: boolean; distance?: number; reason?: string } {
    // Parse object coordinates
    let objCoords: { lat: number; lng: number };

    if (typeof object.coordinates === 'string') {
        try {
            objCoords = JSON.parse(object.coordinates);
        } catch {
            return { valid: false, reason: 'Invalid object coordinates format' };
        }
    } else {
        objCoords = object.coordinates;
    }

    // Calculate distance
    const distance = calculateDistance(
        playerLat,
        playerLng,
        objCoords.lat,
        objCoords.lng
    );

    // Get trigger radius (default 50 meters)
    const triggerRadius = object.triggerRadius || 50;

    // Check if within radius
    if (distance <= triggerRadius) {
        return { valid: true, distance };
    }

    return {
        valid: false,
        distance,
        reason: `Player is ${Math.round(distance)}m away, requires ${triggerRadius}m`
    };
}

/**
 * Validate puzzle is linked to object (player must complete object before puzzle)
 */
export function validatePuzzleLinkedToObject(
    questData: QuestData,
    puzzleId: string,
    objectId: string
): boolean {
    const puzzle = validatePuzzleExists(questData, puzzleId);
    if (!puzzle) return false;

    // Check linked_objects array
    if (puzzle.linked_objects && puzzle.linked_objects.includes(objectId)) {
        return true;
    }

    // Check legacy unlocksPuzzleId
    const object = validateObjectExists(questData, objectId);
    if (object && object.unlocksPuzzleId === puzzleId) {
        return true;
    }

    // Check object media timeline
    if (object) {
        const timelineItems = (object as any).mediaTimeline?.items ?? (object as any).media_timeline?.items;
        if (Array.isArray(timelineItems)) {
            const found = timelineItems.some((it: any) => it?.type === 'puzzle' && (it?.puzzleId === puzzleId || it?.puzzle_id === puzzleId));
            if (found) return true;
        }
    }

    return false;
}

/**
 * Validate that player hasn't completed action too quickly (anti-cheat)
 */
export function validateActionCooldown(
    lastActionTimestamp: string | undefined,
    minCooldownMs: number = 1000
): { valid: boolean; reason?: string } {
    if (!lastActionTimestamp) {
        return { valid: true };
    }

    const now = Date.now();
    const lastAction = new Date(lastActionTimestamp).getTime();
    const timeSinceLastAction = now - lastAction;

    if (timeSinceLastAction < minCooldownMs) {
        return {
            valid: false,
            reason: `Action too fast: ${timeSinceLastAction}ms (min: ${minCooldownMs}ms)`
        };
    }

    return { valid: true };
}

/**
 * Validate points awarded match expected points for object/puzzle
 */
export function validatePoints(
    item: QuestObject | QuestPuzzle,
    claimedPoints: number
): { valid: boolean; expectedPoints?: number; reason?: string } {
    const expectedPoints = (item as QuestObject).points || 0;

    if (claimedPoints !== expectedPoints) {
        return {
            valid: false,
            expectedPoints,
            reason: `Points mismatch: claimed ${claimedPoints}, expected ${expectedPoints}`
        };
    }

    return { valid: true, expectedPoints };
}

/**
 * Rate limiting: Check if player has exceeded action rate limit
 */
export function validateRateLimit(
    actionCount: number,
    timeWindowMs: number,
    maxActions: number
): { valid: boolean; reason?: string } {
    if (actionCount > maxActions) {
        return {
            valid: false,
            reason: `Rate limit exceeded: ${actionCount} actions in ${timeWindowMs}ms (max: ${maxActions})`
        };
    }

    return { valid: true };
}

/**
 * Comprehensive validation for completing an object
 */
export interface ValidateCompleteObjectOptions {
    questData: QuestData;
    objectId: string;
    timestamp: string;
    points: number;
    playerLocation?: { lat: number; lng: number };
    lastActionTimestamp?: string;
    requireProximity?: boolean;
}

export function validateCompleteObject(
    options: ValidateCompleteObjectOptions
): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const {
        questData,
        objectId,
        timestamp,
        points,
        playerLocation,
        lastActionTimestamp,
        requireProximity = false
    } = options;

    // 1. Validate timestamp
    if (!validateTimestamp(timestamp)) {
        errors.push('Invalid timestamp');
    }

    // 2. Validate object exists
    const object = validateObjectExists(questData, objectId);
    if (!object) {
        errors.push('Object not found');
        return { valid: false, errors };
    }

    // 3. Validate points
    const pointsValidation = validatePoints(object, points);
    if (!pointsValidation.valid) {
        errors.push(pointsValidation.reason!);
    }

    // 4. Validate proximity (if required and location provided)
    if (requireProximity && playerLocation) {
        const proximityValidation = validateProximity(
            object,
            playerLocation.lat,
            playerLocation.lng
        );
        if (!proximityValidation.valid) {
            errors.push(proximityValidation.reason!);
        }
    }

    // 5. Validate action cooldown
    const cooldownValidation = validateActionCooldown(lastActionTimestamp);
    if (!cooldownValidation.valid) {
        errors.push(cooldownValidation.reason!);
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Comprehensive validation for completing a puzzle
 */
export interface ValidateCompletePuzzleOptions {
    questData: QuestData;
    puzzleId: string;
    timestamp: string;
    points: number;
    completedObjects?: string[];
    lastActionTimestamp?: string;
}

export function validateCompletePuzzle(
    options: ValidateCompletePuzzleOptions
): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const {
        questData,
        puzzleId,
        timestamp,
        points,
        completedObjects = [],
        lastActionTimestamp
    } = options;

    // 1. Validate timestamp
    if (!validateTimestamp(timestamp)) {
        errors.push('Invalid timestamp');
    }

    // 2. Validate puzzle exists
    const puzzle = validatePuzzleExists(questData, puzzleId);
    if (!puzzle) {
        errors.push('Puzzle not found');
        return { valid: false, errors };
    }

    // 3. Validate points (puzzles may not have points field, so skip if not present)
    if ((puzzle as any).points !== undefined) {
        const pointsValidation = validatePoints(puzzle, points);
        if (!pointsValidation.valid) {
            errors.push(pointsValidation.reason!);
        }
    }

    // 4. Validate player has completed linked object
    if (puzzle.linked_objects && puzzle.linked_objects.length > 0) {
        const hasCompletedLinkedObject = puzzle.linked_objects.some(objId =>
            completedObjects.includes(objId)
        );
        if (!hasCompletedLinkedObject) {
            errors.push('Must complete linked object before puzzle');
        }
    }

    // 5. Validate action cooldown
    const cooldownValidation = validateActionCooldown(lastActionTimestamp);
    if (!cooldownValidation.valid) {
        errors.push(cooldownValidation.reason!);
    }

    return {
        valid: errors.length === 0,
        errors
    };
}
