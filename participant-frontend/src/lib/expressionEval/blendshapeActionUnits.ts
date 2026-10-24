import type { ActionUnitId } from './protocol';

export type ActionUnitValues = Partial<Record<ActionUnitId, number>>;

const BLENDSHAPES_BY_ACTION_UNIT: Partial<Record<ActionUnitId, readonly string[]>> = {
  AU1: ['browInnerUp'],
  AU2: ['browOuterUpLeft', 'browOuterUpRight'],
  AU4: ['browDownLeft', 'browDownRight'],
  AU6: ['cheekSquintLeft', 'cheekSquintRight'],
  AU12: ['mouthSmileLeft', 'mouthSmileRight'],
  AU15: ['mouthFrownLeft', 'mouthFrownRight'],
  AU20: ['mouthStretchLeft', 'mouthStretchRight'],
  AU26: ['jawOpen'],
};

export function blendshapesToActionUnits(scores: Readonly<Record<string, number>>): ActionUnitValues {
  return Object.fromEntries(
    Object.entries(BLENDSHAPES_BY_ACTION_UNIT).map(([unit, names]) => [
      unit,
      names.reduce((sum, name) => sum + (scores[name] ?? 0), 0) / names.length,
    ]),
  );
}
