export interface ScanpathConnection {
  readonly fromIndex: number;
  readonly toIndex: number;
}

export const buildScanpathConnections = (fixations: ReadonlyArray<{ participantId: string }>): ScanpathConnection[] => {
  const lastIndexByParticipant = new Map<string, number>();
  return fixations.flatMap((fixation, toIndex) => {
    const fromIndex = lastIndexByParticipant.get(fixation.participantId);
    lastIndexByParticipant.set(fixation.participantId, toIndex);
    return fromIndex === undefined ? [] : [{ fromIndex, toIndex }];
  });
};
