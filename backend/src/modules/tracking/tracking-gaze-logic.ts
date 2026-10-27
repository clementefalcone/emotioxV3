/**
 * Website Tracking gaze logic — pure functions, no DOM, no MediaPipe.
 *
 * Cursor = primary attention signal.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GazeDirection {
  horizontal: 'left' | 'center' | 'right';
  vertical: 'up' | 'center' | 'down';
}

export type AttentionState = 'engaged' | 'distracted' | 'away';

export type GazeQuadrant =
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEAD_DISTRACTED_DEG = 30;

// ---------------------------------------------------------------------------
// Iris displacement
// ---------------------------------------------------------------------------

/**
 * Estimate attention state from iris visibility and head pose.
 * - engaged: looking at screen (iris visible, head roughly forward)
 * - distracted: head turned significantly but iris still trackable
 * - away: no iris detected (looking away, eyes closed, left frame)
 */
export function estimateAttentionState(
  irisVisible: boolean,
  headYawDeg: number,
  headPitchDeg: number,
): AttentionState {
  if (!irisVisible) return 'away';
  if (Math.abs(headYawDeg) > HEAD_DISTRACTED_DEG || Math.abs(headPitchDeg) > HEAD_DISTRACTED_DEG) {
    return 'distracted';
  }
  return 'engaged';
}

// ---------------------------------------------------------------------------
// Cursor-gaze correlation
// ---------------------------------------------------------------------------

/**
 * Check if gaze direction roughly matches the viewport area where the cursor is.
 * Center gaze is permissive — matches any cursor position (person is looking at screen).
 */
export function gazeMatchesCursorArea(
  gaze: GazeDirection,
  cursorX: number, cursorY: number,
  viewportW: number, viewportH: number,
): boolean {
  if (gaze.horizontal === 'center' && gaze.vertical === 'center') return true;

  const cursorH: GazeDirection['horizontal'] =
    cursorX < viewportW / 3 ? 'left' :
    cursorX > viewportW * 2 / 3 ? 'right' : 'center';

  const cursorV: GazeDirection['vertical'] =
    cursorY < viewportH / 3 ? 'up' :
    cursorY > viewportH * 2 / 3 ? 'down' : 'center';

  const hMatch = gaze.horizontal === 'center' || gaze.horizontal === cursorH;
  const vMatch = gaze.vertical === 'center' || gaze.vertical === cursorV;

  return hMatch && vMatch;
}

// ---------------------------------------------------------------------------
// Attention score
// ---------------------------------------------------------------------------

/**
 * Combine attention state + cursor-gaze match into a 0-1 score.
 * - 1.0: engaged and looking where cursor is
 * - 0.7: engaged but looking elsewhere on screen
 * - 0.3: distracted (head turned)
 * - 0.0: away (not visible)
 */
export function computeAttentionScore(
  state: AttentionState,
  cursorMatch: boolean,
): number {
  if (state === 'away') return 0;
  if (state === 'distracted') return 0.3;
  return cursorMatch ? 1.0 : 0.7;
}
