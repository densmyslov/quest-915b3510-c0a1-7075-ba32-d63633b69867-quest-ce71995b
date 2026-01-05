# Steps Mode - Quest Testing & Development Tool

## Overview

Steps mode is a manual quest progression tool that simulates GPS-based gameplay without requiring physical movement. It allows developers and testers to experience the full quest flow by manually triggering arrivals at quest objects.

**Status:** ✅ Production-ready (December 2025)

## Key Features

- **Manual Arrival Simulation**: Click "Next" to simulate GPS arrival at quest objects
- **Full Play Mode Behavior**: Triggers same APIs, notifications, and audio as GPS-based arrivals
- **GPS Position Updates**: Automatically updates PlayerState.position to object coordinates
- **Visual Feedback**: `[SIMULATED]` prefix distinguishes manual from GPS arrivals
- **Sequential Navigation**: Progress through quest objects in itinerary order
- **Backward Navigation**: Review previous objects without re-triggering arrivals

## How It Works

### Activation

Steps mode can be toggled on/off via the "Steps mode" button in the quest map overlay.

**Button States:**
- **Off (Default)**: Normal GPS-based play mode
- **On**: Manual progression with next/prev controls

### User Interface

When steps mode is active, three controls appear:

```
[← Prev]  [3/12]  [Next →]
```

- **Prev**: Decrement step counter (review only, no arrival)
- **Step Counter**: Shows current/total objects (e.g., "3/12")
- **Next**: Advance to next object and simulate arrival

### Timeline Panel (Steps Mode)

Steps mode also shows a **Timeline** card for the current object:

- **Open**: Opens the puzzle for the current timeline item.
- **Skip**: Marks the item as completed.
  - For **puzzle** items, Skip simulates puzzle completion and **awards points** (counts toward the "For" score).
  - If puzzle points are not specified, it falls back to **100** points.

### Arrival Simulation Flow

When clicking "Next", the following sequence occurs:

```
1. Find object with itinerary number = current step + 1
   ↓
2. Update GPS position via POST /api/quest/update-position
   - latitude: object.coordinates.lat
   - longitude: object.coordinates.lng
   - accuracy: 0 (perfect accuracy for simulation)
   ↓
3. Trigger arrival via POST /api/quest/arrive
   - sessionId: current session
   - objectId: target object ID
   - distance: 0 (simulated arrival)
   ↓
4. Show arrival notification
   - Current object: "[SIMULATED] 🎯 Sei arrivato a [name]! Completa gli enigmi."
   - Other objects: "[SIMULATED] Hai raggiunto [name]"
   - Completed: "[SIMULATED] Hai raggiunto [name] (già completato)"
   ↓
5. Run the object timeline (if configured)
   - Timeline items can play audio/effects/text or open puzzles
   - Audio comes from timeline items (not legacy object.audio_effect)
   ↓
6. Increment step counter
```

## Visibility Behavior

Steps mode uses a **different visibility model** than play mode:

### Play Mode (GPS-based)
- **Sliding Window**: Only shows current + previous objects
- **Dynamic**: Updates based on completion status
- **Limited Preview**: Cannot see future objects

### Steps Mode
- **Progressive Reveal**: Shows all objects up to current step
- **Static**: Based on itinerary number, not completion
- **Full Preview**: Can see all objects you've stepped through

**Formula:** `visible if (object.itineraryNumber <= currentStep)`

## Technical Implementation

### Architecture

The arrival simulation is implemented via the `useArrivalSimulation` hook:

**File:** `src/hooks/useArrivalSimulation.ts`

**Exports:**
- `handleObjectArrival()`: Shared arrival logic for GPS and manual triggers
- `simulateArrivalWithPosition()`: Full simulation with position update

### Integration Points

**QuestMap.tsx modifications:**

```typescript
// Initialize hook
const { handleObjectArrival, simulateArrivalWithPosition } = useArrivalSimulation({
    sessionId: currentSessionId,
    completedObjects: questProgress.completedObjects,
    visibleObjects,
    getItineraryNumber,
    showNotification,
    onArrived: (obj) => {
        void runObjectTimeline(obj);
    }
});

// GPS arrivals (normal play mode)
const handleEnterZone = useCallback(({ stop, distance }) => {
    const obj = objectsById.get(stop.id);
    if (!obj) return;
    handleObjectArrival(obj, distance, false); // isSimulated = false
}, [objectsById, handleObjectArrival]);

// Manual arrivals (steps mode)
const nextStep = useCallback(async () => {
    const nextStepNumber = currentItineraryStep + 1;
    const targetEntry = itineraryEntries.find(entry => entry.num === nextStepNumber);

    if (targetEntry) {
        const targetObject = objectsById.get(targetEntry.id);
        if (targetObject) {
            await simulateArrivalWithPosition(targetObject); // GPS + arrival
        }
    }

    setCurrentItineraryStep(prev => Math.min(prev + 1, itineraryRange.end));
}, [currentItineraryStep, itineraryEntries, objectsById, simulateArrivalWithPosition]);
```

### API Calls

Steps mode makes the same API calls as play mode:

#### 1. Position Update
```http
POST /api/quest/update-position
Content-Type: application/json

{
  "sessionId": "session-123",
  "position": {
    "coords": {
      "latitude": 45.4341,
      "longitude": 12.3387,
      "accuracy": 0
    },
    "timestamp": 1735392000000
  }
}
```

#### 2. Arrival Recording
```http
POST /api/quest/arrive
Content-Type: application/json

{
  "sessionId": "session-123",
  "objectId": "obj-1",
  "timestamp": "2025-12-28T10:00:00Z",
  "distance": 0
}
```

**Key Difference:** `distance: 0` indicates simulated arrival vs actual GPS distance.

## Use Cases

### 1. Development Testing
- **Test quest flow** without leaving desk
- **Verify object sequence** and puzzle integration
- **Debug audio triggers** and notifications
- **Test state transitions** (locked → arrived → completed)

### 2. Quality Assurance
- **Rapid testing** of entire quest without physical movement
- **Edge case testing** (completed objects, sequential completion)
- **Integration testing** with backend APIs
- **User experience validation** before field testing

### 3. Content Review
- **Preview quest narrative** in correct order
- **Review audio content** for all locations
- **Validate puzzle placement** and difficulty progression
- **Check notification messages** and timing

### 4. Demonstration
- **Show quest flow** to stakeholders
- **Demo features** without GPS dependency
- **Present narrative** in controlled environment
- **Training** for quest designers

## Comparison with Play Mode

| Feature | Play Mode (GPS) | Steps Mode (Manual) |
|---------|----------------|---------------------|
| Arrival Trigger | GPS proximity (30m radius) | Manual "Next" click |
| Position Update | Real GPS coordinates | Simulated (object coordinates) |
| Visibility | Sliding window (2 objects) | Progressive (all up to step) |
| Distance | Actual GPS distance | 0 (simulated) |
| Notification | Standard message | `[SIMULATED]` prefix |
| API Calls | Same | Same |
| Audio Playback | Yes | Yes |
| State Updates | Yes | Yes |
| Puzzle Solving | Manual | Manual |
| Object Completion | Manual | Manual |

## Best Practices

### For Testers

1. **Start from beginning**: Enable steps mode before starting quest
2. **Test sequentially**: Use Next/Prev to verify proper object order
3. **Complete puzzles**: Test full flow including puzzle solving
4. **Check notifications**: Verify message accuracy and timing
5. **Listen to audio**: Ensure audio triggers correctly
6. **Test completion**: Verify final object completion and quest end state

### For Developers

1. **Use for rapid iteration**: Test code changes without GPS delays
2. **Debug with console**: Check API responses and state updates
3. **Validate idempotency**: Click Next multiple times on same object
4. **Test edge cases**: Try prev/next on completed objects
5. **Monitor network**: Verify API calls and responses

### For Designers

1. **Review narrative flow**: Experience story in intended order
2. **Check pacing**: Ensure audio and puzzle timing feels right
3. **Validate hints**: Verify hint system triggers correctly
4. **Test difficulty curve**: Ensure puzzle difficulty progresses smoothly

## Limitations

### What Steps Mode Does NOT Do

- ❌ **Auto-complete puzzles**: Puzzles must still be solved manually
- ❌ **Skip objects**: Must progress sequentially through itinerary
- ❌ **Bypass state validation**: Server-side validation still applies
- ❌ **Generate real GPS data**: Position is simulated, not real movement
- ❌ **Test GPS accuracy**: Cannot test actual GPS precision or errors

### When to Use Real GPS Testing

Use actual GPS testing for:
- GPS accuracy validation
- Trigger radius tuning
- Battery consumption testing
- Real-world environmental factors
- Network connectivity issues
- Movement-based game mechanics

## Troubleshooting

### "Next" Button Disabled

**Cause:** Reached end of itinerary or no more objects

**Solution:**
- Check step counter (e.g., "12/12" means last object)
- Verify objects have valid itinerary numbers
- Use "Prev" to go back

### No Notification Shown

**Cause:** Notification display issue or timing

**Solution:**
- Check browser console for errors
- Verify object has valid name
- Check if previous notification still showing

### Audio Not Playing

**Cause:** Audio unlock required or missing audio configuration

**Solution:**
- Select `Play mode` / `Steps mode` (mode selection unlocks audio)
- Verify the object timeline includes audio items (audio / streaming_text_audio)
- Check audio URL is valid
- Review browser console for errors

### API Calls Failing

**Cause:** No active session or network issues

**Solution:**
- Ensure quest is started (sessionId exists)
- Check network connectivity
- Verify API endpoints are running
- Review server logs

### Position Not Updating

**Cause:** Object missing coordinates or API error

**Solution:**
- Verify object has valid coordinates
- Check object.coordinates format
- Review `/api/quest/update-position` response
- Check server logs for errors

## Related Documentation

- [Quest State Management](./QUEST_STATE.md) - Backend state system
- [Audio Effects](./AUDIO_EFFECTS.md) - Audio trigger configuration
- [Puzzles](./PUZZLES.md) - Puzzle integration
- [Map Effects](./MAP_EFFECTS.md) - Visual effects on map

## Code References

- Hook: [useArrivalSimulation.ts](../src/hooks/useArrivalSimulation.ts)
- Integration: [QuestMap.tsx](../src/components/QuestMap.tsx)
- UI: [QuestMapOverlay.tsx](../src/components/QuestMapOverlay.tsx)
- API: [/api/quest/arrive](../src/app/api/quest/arrive/route.ts)
- API: [/api/quest/update-position](../src/app/api/quest/update-position/route.ts)

## Version History

- **v2.0 (December 2025)**: Enhanced with full arrival simulation
  - Added GPS position updates
  - Added API call integration
  - Added audio playback
  - Extracted arrival logic to shared hook

- **v1.0**: Initial steps mode
  - Basic step counter
  - Object visibility control
  - No arrival simulation
