import type { ActionUnits } from '../eyeTracking/facsClassifier';

export type ActionUnitId = keyof ActionUnits;
export type ExpressionIntensity = 'suave' | 'medio' | 'maximo';
export type ProtocolStepKind = 'neutral' | 'expression' | 'rest' | 'head-pose';

export interface ProtocolStep {
  kind: ProtocolStepKind;
  label: string;
  instruction: string;
  durationMs: number;
  round: number;
  intensity: ExpressionIntensity | null;
  targetActionUnits: ActionUnitId[];
}

interface Expression {
  label: string;
  instruction: string;
  targetActionUnits: ActionUnitId[];
}

export const PROTOCOL_VERSION = 1;
export const ROUND_COUNT = 2;
export const INITIAL_NEUTRAL_MS = 10000;
export const EXPRESSION_MS = 3000;
export const REST_MS = 3000;
export const HEAD_POSE_MS = 3000;

export const EXPRESSIONS: readonly Expression[] = [
  { label: 'brows-up', instruction: 'Levanta las cejas', targetActionUnits: ['AU1', 'AU2'] },
  { label: 'brow-lower', instruction: 'Frunce el ceño', targetActionUnits: ['AU4'] },
  { label: 'smile', instruction: 'Sonríe con la boca, sin entrecerrar los ojos', targetActionUnits: ['AU12'] },
  { label: 'full-smile', instruction: 'Sonríe con toda la cara, hasta entrecerrar los ojos', targetActionUnits: ['AU6', 'AU12'] },
  { label: 'corners-down', instruction: 'Baja las comisuras de la boca', targetActionUnits: ['AU15'] },
  { label: 'lip-stretch', instruction: 'Estira los labios hacia los lados, sin sonreír', targetActionUnits: ['AU20'] },
  { label: 'lips-part', instruction: 'Separa los labios, sin bajar la mandíbula', targetActionUnits: ['AU25'] },
  { label: 'jaw-drop', instruction: 'Abre la boca dejando caer la mandíbula', targetActionUnits: ['AU25', 'AU26'] },
];

const INTENSITIES: readonly ExpressionIntensity[] = ['suave', 'medio', 'maximo'];

const HEAD_POSES: readonly { label: string; instruction: string }[] = [
  { label: 'head-left', instruction: 'Gira un poco la cabeza a la izquierda, con la cara relajada' },
  { label: 'head-right', instruction: 'Gira un poco la cabeza a la derecha, con la cara relajada' },
  { label: 'head-up', instruction: 'Levanta un poco el mentón, con la cara relajada' },
  { label: 'head-down', instruction: 'Baja un poco el mentón, con la cara relajada' },
];

function restStep(round: number): ProtocolStep {
  return { kind: 'rest', label: 'rest', instruction: 'Cara relajada', durationMs: REST_MS, round, intensity: null, targetActionUnits: [] };
}

function buildRound(round: number): ProtocolStep[] {
  const expressions = round % 2 === 0 ? [...EXPRESSIONS].reverse() : EXPRESSIONS;
  const expressionSteps = expressions.flatMap(expression => INTENSITIES.flatMap(intensity => [
    {
      kind: 'expression' as const,
      label: expression.label,
      instruction: expression.instruction,
      durationMs: EXPRESSION_MS,
      round,
      intensity,
      targetActionUnits: expression.targetActionUnits,
    },
    restStep(round),
  ]));
  const headPoseSteps = HEAD_POSES.flatMap(pose => [
    { kind: 'head-pose' as const, label: pose.label, instruction: pose.instruction, durationMs: HEAD_POSE_MS, round, intensity: null, targetActionUnits: [] },
    restStep(round),
  ]);
  return [...expressionSteps, ...headPoseSteps];
}

export function buildExpressionProtocol(): ProtocolStep[] {
  const neutral: ProtocolStep = {
    kind: 'neutral',
    label: 'neutral',
    instruction: 'Cara relajada, mirando la pantalla',
    durationMs: INITIAL_NEUTRAL_MS,
    round: 0,
    intensity: null,
    targetActionUnits: [],
  };
  return [neutral, ...Array.from({ length: ROUND_COUNT }, (_, index) => buildRound(index + 1)).flat()];
}
