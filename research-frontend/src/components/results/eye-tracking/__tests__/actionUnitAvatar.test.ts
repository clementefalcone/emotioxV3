import { describe, expect, it } from 'vitest';
import { buildAvatarPose } from '../actionUnitAvatar';

const neutral = buildAvatarPose({});

describe('buildAvatarPose', () => {
  it('raises only the inner brow ends for AU1 and the outer ends for AU2', () => {
    const innerRaise = buildAvatarPose({ AU1: 1 });
    const outerRaise = buildAvatarPose({ AU2: 1 });

    expect(innerRaise.leftBrow.inner.y).toBeLessThan(neutral.leftBrow.inner.y);
    expect(innerRaise.leftBrow.outer.y).toBe(neutral.leftBrow.outer.y);
    expect(outerRaise.leftBrow.outer.y).toBeLessThan(neutral.leftBrow.outer.y);
    expect(outerRaise.leftBrow.inner.y).toBe(neutral.leftBrow.inner.y);
  });

  it('lowers and draws the brows together for AU4, mirrored on both sides', () => {
    const pose = buildAvatarPose({ AU4: 1 });

    expect(pose.leftBrow.inner.y).toBeGreaterThan(neutral.leftBrow.inner.y);
    expect(pose.leftBrow.inner.x).toBeGreaterThan(neutral.leftBrow.inner.x);
    expect(pose.rightBrow.inner.x).toBe(200 - pose.leftBrow.inner.x);
  });

  it('lifts the mouth corners for AU12 and drops them for AU15', () => {
    expect(buildAvatarPose({ AU12: 1 }).mouth.leftCorner.y).toBeLessThan(neutral.mouth.leftCorner.y);
    expect(buildAvatarPose({ AU15: 1 }).mouth.leftCorner.y).toBeGreaterThan(neutral.mouth.leftCorner.y);
  });

  it('opens the lips a little for AU25 and drops the jaw for AU26', () => {
    const lipsPart = buildAvatarPose({ AU25: 1 });
    const jawDrop = buildAvatarPose({ AU26: 1 });

    expect(neutral.mouth.openGap).toBe(0);
    expect(lipsPart.mouth.openGap).toBeGreaterThan(0);
    expect(jawDrop.mouth.openGap).toBeGreaterThan(lipsPart.mouth.openGap);
    expect(jawDrop.chinY).toBeGreaterThan(neutral.chinY);
  });

  it('narrows the eyes from below for AU6', () => {
    const pose = buildAvatarPose({ AU6: 1 });

    expect(pose.leftEye.lowerLidY).toBeLessThan(neutral.leftEye.lowerLidY);
    expect(pose.cheekLift).toBe(1);
  });

  it('scales with intensity and ignores values outside 0..1', () => {
    expect(buildAvatarPose({ AU26: 0.5 }).chinY).toBeCloseTo(neutral.chinY + 5);
    expect(buildAvatarPose({ AU26: 3 })).toEqual(buildAvatarPose({ AU26: 1 }));
    expect(buildAvatarPose({ AU26: -1 })).toEqual(neutral);
  });
});
