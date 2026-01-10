import { v4 as uuidv4 } from 'uuid';

const DEVICE_ID_KEY = 'quest_device_id';

/**
 * Retrieves a persistent, unique ID for this device/browser.
 * Generates a new UUID v4 if one doesn't exist.
 */
export function getOrCreateDeviceId(): string {
    if (typeof window === 'undefined') {
        return 'server-side-placeholder';
    }

    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored) return stored;

    const newId = uuidv4();
    localStorage.setItem(DEVICE_ID_KEY, newId);
    return newId;
}
