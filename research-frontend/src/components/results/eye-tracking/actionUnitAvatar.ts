export type ActionUnitKey = 'AU1' | 'AU2' | 'AU4' | 'AU6' | 'AU12' | 'AU15' | 'AU20' | 'AU25' | 'AU26';
export type ActionUnitIntensities = Partial<Record<ActionUnitKey, number>>;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface BrowShape {
  readonly inner: Point;
  readonly middle: Point;
  readonly outer: Point;
}

export interface EyeShape {
  readonly center: Point;
  readonly upperLidY: number;
  readonly lowerLidY: number;
}

export interface MouthShape {
  readonly leftCorner: Point;
  readonly rightCorner: Point;
  readonly centerY: number;
  readonly smileDepth: number;
  readonly openGap: number;
}

export interface AvatarPose {
  readonly leftBrow: BrowShape;
  readonly rightBrow: BrowShape;
  readonly leftEye: EyeShape;
  readonly rightEye: EyeShape;
  readonly cheekLift: number;
  readonly frownDepth: number;
  readonly mouth: MouthShape;
  readonly chinY: number;
}

export const AVATAR_CENTER_X = 100;

const mirror = (point: Point): Point => ({ x: AVATAR_CENTER_X * 2 - point.x, y: point.y });

const mirrorBrow = (brow: BrowShape): BrowShape => ({ inner: mirror(brow.inner), middle: mirror(brow.middle), outer: mirror(brow.outer) });

const buildLeftBrow = (inner: number, outer: number, lowerer: number): BrowShape => ({
  inner: { x: 90 + 3 * lowerer, y: 102 - 7 * inner + 5 * lowerer },
  middle: { x: 77, y: 96 - 3 * inner - 3 * outer + 3 * lowerer },
  outer: { x: 64, y: 104 - 7 * outer + lowerer },
});

const buildEye = (centerX: number, browRaise: number, cheekRaise: number): EyeShape => ({
  center: { x: centerX, y: 118 },
  upperLidY: 107 - 2 * browRaise + 2 * cheekRaise,
  lowerLidY: 125 - 5 * cheekRaise,
});

const clampIntensity = (value: number | undefined): number => Math.min(1, Math.max(0, value ?? 0));

export const buildAvatarPose = (units: ActionUnitIntensities): AvatarPose => {
  const intensity = (key: ActionUnitKey) => clampIntensity(units[key]);
  const browRaise = Math.max(intensity('AU1'), intensity('AU2'));
  const smile = intensity('AU12');
  const frown = intensity('AU15');
  const stretch = intensity('AU20');
  const jawDrop = intensity('AU26');
  const leftBrow = buildLeftBrow(intensity('AU1'), intensity('AU2'), intensity('AU4'));
  const leftCorner = { x: 86 - 5 * smile - 7 * stretch, y: 160 + 4 * jawDrop - 6 * smile + 5 * frown + stretch };
  return {
    leftBrow,
    rightBrow: mirrorBrow(leftBrow),
    leftEye: buildEye(78, browRaise, intensity('AU6')),
    rightEye: buildEye(122, browRaise, intensity('AU6')),
    cheekLift: Math.max(intensity('AU6'), smile * 0.6),
    frownDepth: intensity('AU4'),
    mouth: {
      leftCorner,
      rightCorner: mirror(leftCorner),
      centerY: 160 + 4 * jawDrop,
      smileDepth: 2 + 4 * smile - 3 * frown,
      openGap: 3 * intensity('AU25') + 10 * jawDrop,
    },
    chinY: 188 + 10 * jawDrop,
  };
};
