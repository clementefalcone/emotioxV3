const NEUTRAL = {
  leftBrow: 'M20 36 Q28 33 35 36',
  rightBrow: 'M45 36 Q52 33 60 36',
  mouth: 'M30 70 Q40 71 50 70',
  eyeHeight: 2.5,
};

interface FacePose {
  leftBrow?: string;
  rightBrow?: string;
  mouth?: string;
  eyeHeight?: number;
  hasCheeks?: boolean;
}

const AU_POSES: Record<string, FacePose> = {
  AU1: { leftBrow: 'M20 36 Q28 32 35 29', rightBrow: 'M45 29 Q52 32 60 36' },
  AU2: { leftBrow: 'M20 29 Q28 30 35 36', rightBrow: 'M45 36 Q52 30 60 29' },
  AU4: { leftBrow: 'M21 37 Q29 37 37 41', rightBrow: 'M43 41 Q51 37 59 37' },
  AU6: { hasCheeks: true, eyeHeight: 1.2 },
  AU12: { mouth: 'M27 66 Q40 77 53 66' },
  AU15: { mouth: 'M29 73 Q40 66 51 73' },
  AU20: { mouth: 'M23 70 Q40 72 57 70' },
  AU25: { mouth: 'M31 70 Q40 65 49 70 Q40 75 31 70 Z' },
  AU26: { mouth: 'M34 72 Q34 63 40 63 Q46 63 46 72 Q46 82 40 82 Q34 82 34 72 Z' },
};

const GRAY = '#94A3B8';
const ACTIVE = '#4F46E5';

const strokeFor = (isActive: boolean) => (isActive ? ACTIVE : GRAY);

export const ActionUnitFace = ({ au, label }: { au: string; label: string }) => {
  const pose = AU_POSES[au] ?? {};
  const hasBrowMove = Boolean(pose.leftBrow);
  const eyeHeight = pose.eyeHeight ?? NEUTRAL.eyeHeight;
  return (
    <svg viewBox="0 0 80 96" width={80} height={96} role="img" aria-label={`${au} ${label}`}>
      <ellipse cx={40} cy={50} rx={30} ry={38} fill="#F8FAFC" stroke={GRAY} strokeWidth={1.5} />
      <path d={pose.leftBrow ?? NEUTRAL.leftBrow} fill="none" stroke={strokeFor(hasBrowMove)} strokeWidth={hasBrowMove ? 2.5 : 2} strokeLinecap="round" />
      <path d={pose.rightBrow ?? NEUTRAL.rightBrow} fill="none" stroke={strokeFor(hasBrowMove)} strokeWidth={hasBrowMove ? 2.5 : 2} strokeLinecap="round" />
      <ellipse cx={28} cy={44} rx={5} ry={eyeHeight} fill={strokeFor(Boolean(pose.eyeHeight))} />
      <ellipse cx={52} cy={44} rx={5} ry={eyeHeight} fill={strokeFor(Boolean(pose.eyeHeight))} />
      {pose.hasCheeks && (
        <>
          <path d="M19 53 Q25 49 31 52" fill="none" stroke={ACTIVE} strokeWidth={2} strokeLinecap="round" />
          <path d="M49 52 Q55 49 61 53" fill="none" stroke={ACTIVE} strokeWidth={2} strokeLinecap="round" />
        </>
      )}
      <path d="M40 47 L37 59 L42 59" fill="none" stroke={GRAY} strokeWidth={1.5} strokeLinejoin="round" />
      <path d={pose.mouth ?? NEUTRAL.mouth} fill={pose.mouth?.endsWith('Z') ? '#E0E7FF' : 'none'} stroke={strokeFor(Boolean(pose.mouth))} strokeWidth={pose.mouth ? 2.5 : 2} strokeLinecap="round" />
    </svg>
  );
};
