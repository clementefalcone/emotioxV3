import type { EyeTrackingStimulus } from '../../../services/analytics.service';

export const LATER_FIXATION_WEIGHT = 0.35;

export const selectFirstLookPoints = (
  fixations: EyeTrackingStimulus['fixations'],
  count: number,
): Array<{ x: number; y: number; value: number }> => {
  const byParticipant = new Map<string, EyeTrackingStimulus['fixations']>();
  for (const fixation of fixations) byParticipant.set(fixation.participantId, [...(byParticipant.get(fixation.participantId) ?? []), fixation]);
  return Array.from(byParticipant.values()).flatMap(participantFixations =>
    [...participantFixations]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, count)
      .map((fixation, order) => ({ x: fixation.x, y: fixation.y, value: fixation.duration * (order === 0 ? 1 : LATER_FIXATION_WEIGHT) })));
};
