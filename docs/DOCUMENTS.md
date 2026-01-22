# Collectable Documents

Documents are story artifacts (letters, dossiers, photos, clues) that players collect during the quest. Unlike standard images or text nodes, documents are **persistently collected** into a "Folder" overlay, allowing players to review them at any time.

## Configuration

To add a document to the timeline, use the `document` type in the `mediaTimeline` array of a `QuestObject`.

```json
{
  "type": "document",
  "key": "secret_dossier",
  "title": "Secret Dossier",
  "media_url": "https://example.com/dossier.jpg",
  "text": "Top secret information about the target.",
  "blocking": true
}
```

### Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `type` | `string` | Yes | Must be `"document"` |
| `title` | `string` | No | Title displayed in the timeline and folder |
| `media_url` | `string` | No | URL of the document image |
| `text` | `string` | No | Body text displayed below the image |
| `media_id` | `string` | No | Optional reference ID |

## Runtime Behavior

1.  **Timeline**: Appears as a standard timeline item. When "opened" (or automatically if sequential), it displays a `TimelineDocumentOverlay`.
2.  **Completion**: When the user closes the timeline overlay, the node is marked as `completed` in the runtime.
3.  **Collection**: Once completed, the document is automatically added to the **Folder** menu in the top-left of the Quest Map.

## Folder Overlay

The Folder (Dossier) allows players to review all collected documents.

-   **Access**: Click the folder icon in the top-left of the map.
-   **Review**: Click any document thumbnail to open a modal with the full details.
-   **Expansion**: Click the image within the modal to expand it to **fullscreen** for better readability.

## Implementation Details

-   **Timeline Logic**: `useObjectTimeline.ts` handles the `document` type and `TimelineDocumentOverlay`.
-   **Collection**: `useQuestTimelineLogic.ts` aggregates completed document nodes into the `collectedDocuments` list.
-   **Display**: `QuestMapOverlay.tsx` renders the folder button and the document list.
