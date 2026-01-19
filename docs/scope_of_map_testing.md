# Scope of Map Testing

## 1. Player Markers Functionality

### Context
The player marker indicates the user's current GPS position on the game map. It is crucial for navigation in "Play" mode, allowing users to see their location relative to quest objectives.

### Recent Fixes & Behavior
*   **Visibility Persistence**: The player marker must remain visible and correctly attached to the map even after:
    *   Switching between "Play" and "Steps" modes.
    *   Re-initializing the map (e.g., navigating away and back).
    *   The fix involved interacting with the Leaflet map instance lifecycle to ensure the marker reference is cleared and re-created whenever the underlying map instance changes.
*   **Visual Representation**:
    *   The marker is now represented by a specific **Person Icon** (silhouette) instead of a generic pin.
    *   This distinguishes the player's location from static quest locations.

### Testing Scenarios
1.  **Initial Load**: Open the map in Play mode. Verify the person icon appears at the simulated or real GPS location.
2.  **Mode Switching**: Switch to "Steps" mode (where GPS is disabled/hidden) and back to "Play" mode. Verify the person icon reappears immediately.
3.  **Map Re-mount**: Navigate to a different page (e.g., Puzzle) and return to the Map. Verify the icon is present.
4.  **Movement**: simulating movement (or moving in real life) should update the marker position smoothly.
