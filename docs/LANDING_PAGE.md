# Landing Page Architecture

The entry point for the application is **`src/app/page.tsx`**, which implements a sequential state machine to guide the user from the initial splash screen to the main game map.

## State Machine
The landing page flows through the following states (`PageState`):

1.  **`SPLASH`**
    *   **Description**: Displays the title "The Oath of Two Villages" with a dark overlay.
    *   **Duration**: Automatically transitions to `VIDEO` after 2 seconds.
    *   **Visuals**: Title text with fade animations.

2.  **`VIDEO`**
    *   **Description**: Plays the intro video (Cloudflare Stream) in the background.
    *   **Logic**:
        *   Loads Cloudflare Stream SDK via `next/script`.
        *   Auto-plays video (ID: `VIDEO_ID`).
        *   Listens for the `ended` event to transition to `REGISTRATION`.
        *   **Fallback**: Advances automatically after 3 minutes if the video fails or stalls.
        *   **Skip Option**: User can click "Skip Video →" to proceed immediately.

3.  **`REGISTRATION`**
    *   **Description**: Shows the interactive "Letter from the Past" registration form.
    *   **Component**: `RegistrationView` (`src/components/RegistrationView.tsx`).
    *   **Functionality**:
        *   **Name Entry**: Input for player name.
        *   **Mode Selection**: Solo or Team.
        *   **Action**: Clicking "Attraversa il Portale" (or similar) triggers the `TRANSITION_VIDEO` state.

4.  **`TRANSITION_VIDEO`** (New)
    *   **Description**: Plays a second video (ID: `VIDEO_2_ID`) bridging the registration and the narrative intro.
    *   **Logic**:
        *   Renders a high-z-index video overlay.
        *   Auto-plays `VIDEO_2_ID`.
        *   On `ended`, transitions to `INTRO`.
        *   **Skip Option**: User can click "Skip →".

5.  **`INTRO`**
    *   **Description**: Displays personalized narrative text (typewriter effect) explaining the player's ancestry and mission.
    *   **Logic**: Generates a random ancestor name/year based on user input for immersion.
    *   **Action**: Clicking "Begin Journey" navigates to `/map`.

## Key Files

*   **`src/app/page.tsx`**: Main controller and state management.
*   **`src/components/RegistrationView.tsx`**: The UI for the registration form (handling inputs, modes, and team code generation).
*   **`src/components/RegistrationView.module.css`**: Vintage styling for the registration letter/form.
