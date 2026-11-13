import { useId } from 'react';
import { buildAvatarPose, type ActionUnitKey, type AvatarPose, type BrowShape, type EyeShape, type MouthShape } from './actionUnitAvatar';

interface Highlight {
  readonly glow: { cx: number; cy: number; rx: number; ry: number };
  readonly arrows: readonly string[];
}

const HIGHLIGHTS: Record<ActionUnitKey, Highlight> = {
  AU1: { glow: { cx: 100, cy: 98, rx: 26, ry: 12 }, arrows: ['M90 92 L90 80', 'M110 92 L110 80'] },
  AU2: { glow: { cx: 100, cy: 98, rx: 46, ry: 12 }, arrows: ['M64 94 L64 82', 'M136 94 L136 82'] },
  AU4: { glow: { cx: 100, cy: 104, rx: 30, ry: 12 }, arrows: ['M78 86 L87 95', 'M122 86 L113 95'] },
  AU6: { glow: { cx: 100, cy: 132, rx: 46, ry: 14 }, arrows: ['M68 150 L72 139', 'M132 150 L128 139'] },
  AU12: { glow: { cx: 100, cy: 158, rx: 32, ry: 12 }, arrows: ['M78 158 L67 150', 'M122 158 L133 150'] },
  AU15: { glow: { cx: 100, cy: 166, rx: 28, ry: 12 }, arrows: ['M82 170 L78 181', 'M118 170 L122 181'] },
  AU20: { glow: { cx: 100, cy: 162, rx: 38, ry: 10 }, arrows: ['M74 162 L62 162', 'M126 162 L138 162'] },
  AU25: { glow: { cx: 100, cy: 162, rx: 22, ry: 14 }, arrows: ['M100 152 L100 146', 'M100 174 L100 183'] },
  AU26: { glow: { cx: 100, cy: 180, rx: 26, ry: 22 }, arrows: ['M100 204 L100 216'] },
};

const SKIN = '#F3CDAE';
const SKIN_SHADE = '#E2AC86';
const SKIN_LINE = '#C98E6A';
const HAIR = '#3B2A24';
const IRIS = '#6B4F3A';
const LIP = '#C45A70';
const LIP_DARK = '#A8445A';
const MOUTH_INSIDE = '#5B1A24';
const TOP = '#0F766E';
const ACTIVE = '#4F46E5';

const controlThrough = (apex: number, from: number, to: number): number => 2 * apex - (from + to) / 2;

const browPath = ({ inner, middle, outer }: BrowShape): string =>
  `M${inner.x} ${inner.y} Q${2 * middle.x - (inner.x + outer.x) / 2} ${2 * middle.y - (inner.y + outer.y) / 2} ${outer.x} ${outer.y}`;

const eyePath = ({ center, upperLidY, lowerLidY }: EyeShape): string => {
  const left = center.x - 13;
  const right = center.x + 13;
  return `M${left} ${center.y} Q${center.x} ${controlThrough(upperLidY, center.y, center.y)} ${right} ${center.y} Q${center.x} ${controlThrough(lowerLidY, center.y, center.y)} ${left} ${center.y} Z`;
};

const upperLidPath = ({ center, upperLidY }: EyeShape, flick: number): string =>
  `M${center.x - 14} ${center.y + 1} Q${center.x} ${controlThrough(upperLidY, center.y, center.y)} ${center.x + 14} ${center.y} l${flick} -3`;

const curveBetween = (mouth: MouthShape, apexY: number, isReversed = false): string => {
  const { leftCorner: from, rightCorner: to } = isReversed ? { leftCorner: mouth.rightCorner, rightCorner: mouth.leftCorner } : mouth;
  return `Q100 ${controlThrough(apexY, from.y, to.y)} ${to.x} ${to.y}`;
};

function Eye({ eye, clipId, flick }: { readonly eye: EyeShape; readonly clipId: string; readonly flick: number }) {
  return (
    <>
      <clipPath id={clipId}><path d={eyePath(eye)} /></clipPath>
      <path d={eyePath(eye)} fill="#FFFFFF" />
      <g clipPath={`url(#${clipId})`}>
        <circle cx={eye.center.x} cy={eye.center.y - 0.5} r={7} fill={IRIS} />
        <circle cx={eye.center.x} cy={eye.center.y - 0.5} r={3.2} fill="#1C1917" />
        <circle cx={eye.center.x + 2.2} cy={eye.center.y - 3} r={1.8} fill="#FFFFFF" />
      </g>
      <path d={upperLidPath(eye, flick)} fill="none" stroke={HAIR} strokeWidth={2.6} strokeLinecap="round" />
    </>
  );
}

function Mouth({ mouth }: { readonly mouth: MouthShape }) {
  const { leftCorner, centerY, smileDepth, openGap } = mouth;
  const lipLineY = centerY + smileDepth * 0.5;
  const lowerLipTopY = lipLineY + openGap;
  const start = `M${leftCorner.x} ${leftCorner.y}`;
  return (
    <>
      {openGap > 0.5 && (
        <>
          <path d={`${start} ${curveBetween(mouth, lipLineY)} ${curveBetween(mouth, lowerLipTopY, true)} Z`} fill={MOUTH_INSIDE} />
          {openGap > 2 && <path d={`${start} ${curveBetween(mouth, lipLineY)} ${curveBetween(mouth, lipLineY + Math.min(openGap, 5) * 0.8, true)} Z`} fill="#FFFFFF" />}
        </>
      )}
      <path d={`${start} Q92 ${lipLineY - 9} 100 ${lipLineY - 5} Q108 ${lipLineY - 9} ${mouth.rightCorner.x} ${mouth.rightCorner.y} ${curveBetween(mouth, lipLineY, true)} Z`} fill={LIP_DARK} />
      <path d={`${start} ${curveBetween(mouth, lowerLipTopY)} ${curveBetween(mouth, lowerLipTopY + 7, true)} Z`} fill={LIP} />
    </>
  );
}

function AvatarFace({ pose, idPrefix }: { readonly pose: AvatarPose; readonly idPrefix: string }) {
  const { chinY } = pose;
  return (
    <>
      <path d="M38 124 C28 52 70 22 100 22 C130 22 172 52 162 124 C166 166 152 206 140 214 L60 214 C48 206 34 166 38 124 Z" fill={HAIR} />
      <path d="M86 168 L86 214 Q100 224 114 214 L114 168 Z" fill={SKIN_SHADE} />
      <path d="M24 240 C28 216 62 206 100 206 C138 206 172 216 176 240 Z" fill={TOP} />
      <path d="M86 206 L100 224 L114 206" fill={SKIN_SHADE} />
      <ellipse cx={52} cy={120} rx={7} ry={12} fill={SKIN_SHADE} />
      <ellipse cx={148} cy={120} rx={7} ry={12} fill={SKIN_SHADE} />
      <path d={`M52 110 C52 64 74 46 100 46 C126 46 148 64 148 110 C148 150 126 ${chinY - 6} 100 ${chinY} C74 ${chinY - 6} 52 150 52 110 Z`} fill={SKIN} />
      <ellipse cx={72} cy={142 - 4 * pose.cheekLift} rx={11} ry={6} fill="#F08A8A" opacity={0.18 + 0.3 * pose.cheekLift} />
      <ellipse cx={128} cy={142 - 4 * pose.cheekLift} rx={11} ry={6} fill="#F08A8A" opacity={0.18 + 0.3 * pose.cheekLift} />
      <Eye eye={pose.leftEye} clipId={`${idPrefix}-eye-left`} flick={-3} />
      <Eye eye={pose.rightEye} clipId={`${idPrefix}-eye-right`} flick={3} />
      <path d={browPath(pose.leftBrow)} fill="none" stroke={HAIR} strokeWidth={4.5} strokeLinecap="round" />
      <path d={browPath(pose.rightBrow)} fill="none" stroke={HAIR} strokeWidth={4.5} strokeLinecap="round" />
      <path d="M97 100 L98 108 M103 100 L102 108" stroke={SKIN_LINE} strokeWidth={1.4} strokeLinecap="round" opacity={pose.frownDepth} />
      <path d="M102 127 C101 133 99 137 97 139 Q101 142 105 139" fill="none" stroke={SKIN_LINE} strokeWidth={1.6} strokeLinecap="round" />
      <Mouth mouth={pose.mouth} />
      <path d="M50 114 C46 62 76 36 106 38 C136 40 156 66 150 108 C142 84 128 70 112 68 C104 84 84 92 60 96 C56 100 52 106 50 114 Z" fill={HAIR} />
    </>
  );
}

export const ActionUnitFace = ({ au, label }: { au: string; label: string }) => {
  const idPrefix = useId().replace(/[^a-zA-Z0-9]/g, '');
  const unit = au as ActionUnitKey;
  const highlight = HIGHLIGHTS[unit];
  return (
    <svg viewBox="0 0 200 240" width={180} height={216} role="img" aria-label={`${au} ${label}`}>
      <defs>
        <linearGradient id={`${idPrefix}-backdrop`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#EEF2FF" />
          <stop offset="1" stopColor="#FFFFFF" />
        </linearGradient>
        <radialGradient id={`${idPrefix}-glow`}>
          <stop offset="0" stopColor={ACTIVE} stopOpacity={0.3} />
          <stop offset="1" stopColor={ACTIVE} stopOpacity={0} />
        </radialGradient>
        <marker id={`${idPrefix}-arrow`} viewBox="0 0 10 10" refX={5} refY={5} markerWidth={9} markerHeight={9} markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0 1 L9 5 L0 9 Z" fill={ACTIVE} />
        </marker>
      </defs>
      <rect width={200} height={240} rx={28} fill={`url(#${idPrefix}-backdrop)`} />
      <AvatarFace pose={buildAvatarPose(highlight ? { [unit]: 1 } : {})} idPrefix={idPrefix} />
      {highlight && (
        <>
          <ellipse className="motion-safe:animate-pulse" {...highlight.glow} fill={`url(#${idPrefix}-glow)`} />
          {highlight.arrows.map(arrow => (
            <path key={arrow} d={arrow} stroke={ACTIVE} strokeWidth={2.6} strokeLinecap="round" markerEnd={`url(#${idPrefix}-arrow)`} />
          ))}
        </>
      )}
    </svg>
  );
};
