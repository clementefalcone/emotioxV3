import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/database', () => ({
  default: { query: vi.fn() },
}));

import { getIATRawTrials, getImplicitAssociationResults } from '../iat.analytics';
import pool from '../../../config/database';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const objectsComparingConfig = {
  structure: {
    components: [
      { id: 'target-1-name', value: 'Chicureo' },
      { id: 'target-2-name', value: 'Curacaví' },
      { id: 'criteria-1', value: 'Positivo' },
      { id: 'criteria-2', value: 'Negativo' },
      { id: 'criteria', value: JSON.stringify([{ id: 'criterion-a', label: 'Navidad' }, { id: 'criterion-b', label: 'Año nuevo' }]) },
    ],
  },
};

const trial = (stimulusId: string, chosen: string) => ({ targetId: stimulusId, criterionId: chosen, rt: 800, correct: true, phase: 'block-2' });

const participantTrials = [
  { targetId: 'target-1', criterionId: 'criteria-1', rt: 900, correct: true, phase: 'block-1' },
  trial('target-1__criterion-a', 'criteria-1'),
  trial('target-1__criterion-a', 'criteria-1'),
  trial('target-1__criterion-b', 'criteria-1'),
  trial('target-1__criterion-b', 'criteria-2'),
  trial('target-2__criterion-a', 'criteria-2'),
  trial('target-2__criterion-a', 'criteria-2'),
  trial('target-2__criterion-b', 'criteria-1'),
  trial('target-2__criterion-b', 'criteria-2'),
];

const loadObjectsComparingModule = async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'module-1', name: 'Objects Comparing', config: JSON.stringify(objectsComparingConfig) }] })
    .mockResolvedValueOnce({ rows: [{ value: JSON.stringify(participantTrials), participant_id: 'p1', created_at: new Date() }] });
  const { modules } = await getImplicitAssociationResults('research-1', 'stage-1');
  return modules[0];
};

const sameChoiceTrials = participantTrials.map((t) => ({ ...t, criterionId: 'criteria-1' }));
const tooFastTrials = participantTrials.map((t) => ({ ...t, rt: 150 }));

const loadThreeParticipants = async (participantIds?: ReadonlySet<string>) => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'module-1', name: 'Objects Comparing', config: JSON.stringify(objectsComparingConfig) }] })
    .mockResolvedValueOnce({
      rows: [
        { value: JSON.stringify(participantTrials), participant_id: 'p-reliable', created_at: new Date() },
        { value: JSON.stringify(sameChoiceTrials), participant_id: 'p-same', created_at: new Date() },
        { value: JSON.stringify(tooFastTrials), participant_id: 'p-fast', created_at: new Date() },
      ],
    });
  const { modules } = await getImplicitAssociationResults('research-1', 'stage-1', { participantIds });
  return modules[0];
};

describe('getImplicitAssociationResults — response quality', () => {
  it('labels every participant without dropping anyone', async () => {
    const mod = await loadThreeParticipants();
    expect(mod.totalResponses).toBe(3);
    expect(mod.responseQualities).toEqual([
      { participantId: 'p-reliable', quality: 'reliable' },
      { participantId: 'p-same', quality: 'same_choice' },
      { participantId: 'p-fast', quality: 'too_fast' },
    ]);
  });

  it('scores only the chosen participants but keeps every quality label', async () => {
    const mod = await loadThreeParticipants(new Set(['p-reliable']));
    expect(mod.totalResponses).toBe(1);
    expect(mod.scores[0].targetScores).toEqual({ 'target-1': 75, 'target-2': 25 });
    expect(mod.responseQualities).toHaveLength(3);
  });
});

describe('getImplicitAssociationResults — Objects Comparing', () => {
  it('scores each object by the share of Positivo/Negativo choices', async () => {
    const mod = await loadObjectsComparingModule();
    expect(mod.scores).toEqual([
      { attributeId: 'criteria-1', attributeLabel: 'Positivo', targetScores: { 'target-1': 75, 'target-2': 25 } },
      { attributeId: 'criteria-2', attributeLabel: 'Negativo', targetScores: { 'target-1': 25, 'target-2': 75 } },
    ]);
  });

  it('breaks the choices down by each attribute the participant faced', async () => {
    const mod = await loadObjectsComparingModule();
    expect(mod.criteriaScores?.map((c) => ({
      label: c.criterionLabel,
      chicureo: c.objectScores['target-1'].dim1Pct,
      curacavi: c.objectScores['target-2'].dim1Pct,
    }))).toEqual([
      { label: 'Navidad', chicureo: 100, curacavi: 0 },
      { label: 'Año nuevo', chicureo: 50, curacavi: 50 },
    ]);
  });
});

describe('getIATRawTrials — Objects Comparing', () => {
  it('names the place, the attribute faced and the choice of every trial', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ stage_id: 'stage-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'module-1', name: 'Objects Comparing', config: JSON.stringify(objectsComparingConfig) }] })
      .mockResolvedValueOnce({ rows: [{ value: JSON.stringify(participantTrials), participant_id: 'p1' }] });
    const { trials } = await getIATRawTrials('research-1', 'module-1');
    expect(trials).toHaveLength(9);
    expect(trials[0]).toMatchObject({ moduleId: 'module-1', trialNumber: 1, phase: 'block-1', targetName: 'Chicureo', attributeLabel: '', criterionLabel: 'Positivo' });
    expect(trials[4]).toMatchObject({ trialNumber: 5, phase: 'block-2', targetName: 'Chicureo', attributeLabel: 'Año nuevo', criterionLabel: 'Negativo', rt: 800 });
  });
});
