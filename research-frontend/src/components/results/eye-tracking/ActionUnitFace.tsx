import { useId } from 'react';

interface Glow {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

interface FacePose {
  glow: Glow;
  arrows: string[];
  leftBrow?: string;
  rightBrow?: string;
  mouth?: string;
  eyeHeight?: number;
  hasCheeks?: boolean;
  hasFrownLines?: boolean;
}

const NEUTRAL = {
  leftBrow: 'M30 39 Q37 36 43 38',
  rightBrow: 'M53 38 Q59 36 66 39',
  mouth: 'M40 70 Q48 72 56 70',
  eyeHeight: 3,
};

const AU_POSES: Record<string, FacePose> = {
  AU1: {
    leftBrow: 'M30 38 Q37 34 43 32',
    rightBrow: 'M53 32 Q59 34 66 38',
    arrows: ['M43 29 L43 23', 'M53 29 L53 23'],
    glow: { cx: 48, cy: 33, rx: 16, ry: 8 },
  },
  AU2: {
    leftBrow: 'M30 32 Q36 32 43 38',
    rightBrow: 'M53 38 Q60 32 66 32',
    arrows: ['M30 29 L30 23', 'M66 29 L66 23'],
    glow: { cx: 48, cy: 34, rx: 24, ry: 8 },
  },
  AU4: {
    leftBrow: 'M31 39 Q38 39 45 43',
    rightBrow: 'M51 43 Q58 39 65 39',
    hasFrownLines: true,
    arrows: ['M39 30 L44 35', 'M57 30 L52 35'],
    glow: { cx: 48, cy: 40, rx: 18, ry: 8 },
  },
  AU6: {
    eyeHeight: 1.3,
    hasCheeks: true,
    arrows: ['M32 63 L34 57', 'M64 63 L62 57'],
    glow: { cx: 48, cy: 52, rx: 24, ry: 9 },
  },
  AU12: {
    mouth: 'M37 68 Q48 78 59 68',
    arrows: ['M36 66 L31 62', 'M60 66 L65 62'],
    glow: { cx: 48, cy: 70, rx: 18, ry: 8 },
  },
  AU15: {
    mouth: 'M39 73 Q48 66 57 73',
    arrows: ['M38 75 L35 80', 'M58 75 L61 80'],
    glow: { cx: 48, cy: 72, rx: 16, ry: 8 },
  },
  AU20: {
    mouth: 'M35 71 Q48 73 61 71',
    arrows: ['M33 71 L28 71', 'M63 71 L68 71'],
    glow: { cx: 48, cy: 71, rx: 22, ry: 7 },
  },
  AU25: {
    mouth: 'M39 70 Q48 66 57 70 Q48 75 39 70 Z',
    arrows: ['M48 64 L48 59', 'M48 76 L48 81'],
    glow: { cx: 48, cy: 70, rx: 14, ry: 9 },
  },
  AU26: {
    mouth: 'M42 71 Q42 64 48 64 Q54 64 54 71 Q54 80 48 80 Q42 80 42 71 Z',
    arrows: ['M48 83 L48 91'],
    glow: { cx: 48, cy: 76, rx: 14, ry: 12 },
  },
};

const FEATURE = '#64748B';
const ACTIVE = '#4F46E5';

const featureColor = (isActive: boolean) => (isActive ? ACTIVE : FEATURE);

export const ActionUnitFace = ({ au, label }: { au: string; label: string }) => {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const pose = AU_POSES[au];
  const hasBrowMove = Boolean(pose?.leftBrow);
  const hasEyeMove = Boolean(pose?.eyeHeight);
  const eyeHeight = pose?.eyeHeight ?? NEUTRAL.eyeHeight;
  const mouth = pose?.mouth ?? NEUTRAL.mouth;
  const isMouthOpen = mouth.endsWith('Z');
  return (
    <svg viewBox="0 0 96 112" width={96} height={112} role="img" aria-label={`${au} ${label}`}>
      <defs>
        <linearGradient id={`${id}-backdrop`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#EEF2FF" />
          <stop offset="1" stopColor="#FFFFFF" />
        </linearGradient>
        <linearGradient id={`${id}-skin`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#F1F5F9" />
        </linearGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0" stopColor={ACTIVE} stopOpacity={0.32} />
          <stop offset="1" stopColor={ACTIVE} stopOpacity={0} />
        </radialGradient>
        <marker id={`${id}-arrow`} viewBox="0 0 10 10" refX={5} refY={5} markerWidth={5} markerHeight={5} markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0 1 L9 5 L0 9 Z" fill={ACTIVE} />
        </marker>
      </defs>
      <rect width={96} height={112} rx={18} fill={`url(#${id}-backdrop)`} />
      <path d="M16 112 Q18 92 48 91 Q78 92 80 112 Z" fill="#E2E8F0" />
      <rect x={41} y={78} width={14} height={16} rx={5} fill="#F1F5F9" />
      <ellipse cx={20} cy={52} rx={3.5} ry={7} fill="#F1F5F9" stroke="#CBD5E1" strokeWidth={1} />
      <ellipse cx={76} cy={52} rx={3.5} ry={7} fill="#F1F5F9" stroke="#CBD5E1" strokeWidth={1} />
      <ellipse cx={48} cy={50} rx={28} ry={34} fill={`url(#${id}-skin)`} stroke="#CBD5E1" strokeWidth={1} />
      <path d="M20 47 Q19 14 48 14 Q77 14 76 47 Q71 25 48 24 Q25 25 20 47 Z" fill="#CBD5E1" />
      {pose && (
        <ellipse className="motion-safe:animate-pulse" cx={pose.glow.cx} cy={pose.glow.cy} rx={pose.glow.rx} ry={pose.glow.ry} fill={`url(#${id}-glow)`} />
      )}
      <path d={pose?.leftBrow ?? NEUTRAL.leftBrow} fill="none" stroke={featureColor(hasBrowMove)} strokeWidth={2.4} strokeLinecap="round" />
      <path d={pose?.rightBrow ?? NEUTRAL.rightBrow} fill="none" stroke={featureColor(hasBrowMove)} strokeWidth={2.4} strokeLinecap="round" />
      {pose?.hasFrownLines && (
        <path d="M47 41 L47 45 M49 41 L49 45" stroke={ACTIVE} strokeWidth={1} strokeLinecap="round" />
      )}
      <ellipse cx={37} cy={46} rx={3.5} ry={eyeHeight} fill={featureColor(hasEyeMove)} />
      <ellipse cx={59} cy={46} rx={3.5} ry={eyeHeight} fill={featureColor(hasEyeMove)} />
      {!hasEyeMove && (
        <>
          <circle cx={38.2} cy={45} r={0.9} fill="#FFFFFF" />
          <circle cx={60.2} cy={45} r={0.9} fill="#FFFFFF" />
        </>
      )}
      {pose?.hasCheeks && (
        <path d="M30 54 Q35 50 40 53 M56 53 Q61 50 66 54" fill="none" stroke={ACTIVE} strokeWidth={2} strokeLinecap="round" />
      )}
      <path d="M44.5 58 Q48 61.5 51.5 58" fill="none" stroke="#94A3B8" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
      <path d={mouth} fill={isMouthOpen ? '#E0E7FF' : 'none'} stroke={featureColor(Boolean(pose?.mouth))} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      {pose?.arrows.map(arrow => (
        <path key={arrow} d={arrow} stroke={ACTIVE} strokeWidth={1.6} strokeLinecap="round" markerEnd={`url(#${id}-arrow)`} />
      ))}
    </svg>
  );
};
