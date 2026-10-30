import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IATModuleResult } from '../../../../services/analytics.service';

const objectsComparingModule: IATModuleResult = {
  moduleId: 'module-1',
  moduleName: 'Objects Comparing',
  testType: 'objects_comparing',
  primingTime: 400,
  targets: [{ id: 'target-1', name: 'Chicureo' }, { id: 'target-2', name: 'Curacaví' }],
  attributes: [{ id: 'criteria-1', label: 'Positivo' }, { id: 'criteria-2', label: 'Negativo' }],
  totalResponses: 102,
  scores: [
    { attributeId: 'criteria-1', attributeLabel: 'Positivo', targetScores: { 'target-1': 81, 'target-2': 75 } },
    { attributeId: 'criteria-2', attributeLabel: 'Negativo', targetScores: { 'target-1': 19, 'target-2': 25 } },
  ],
  criteriaScores: [
    {
      criterionId: 'criterion-a',
      criterionLabel: 'Navidad',
      objectScores: {
        'target-1': { netScore: 66, dim1Pct: 83, dim2Pct: 17, meanRT: 900, trials: 204 },
        'target-2': { netScore: 48, dim1Pct: 74, dim2Pct: 26, meanRT: 950, trials: 204 },
      },
    },
  ],
  responseQualities: [
    { participantId: 'p-reliable', quality: 'reliable' },
    { participantId: 'p-same', quality: 'same_choice' },
    { participantId: 'p-fast', quality: 'too_fast' },
  ],
};

const reliableOnlyModule: IATModuleResult = {
  ...objectsComparingModule,
  totalResponses: 1,
  scores: [
    { attributeId: 'criteria-1', attributeLabel: 'Positivo', targetScores: { 'target-1': 62, 'target-2': 50 } },
    { attributeId: 'criteria-2', attributeLabel: 'Negativo', targetScores: { 'target-1': 38, 'target-2': 50 } },
  ],
};

const getResults = vi.hoisted(() => vi.fn());
const demographicScope = vi.hoisted(() => ({ filteredParticipantIds: null as Set<string> | null }));

vi.mock('../../../../services/analytics.service', () => ({
  getImplicitAssociationResults: getResults,
}));

vi.mock('../../../../hooks/useResultsFilter', () => ({
  useResultsFilter: () => ({
    demographicData: null,
    demographicFilters: {},
    setDemographicFilters: vi.fn(),
    userIdFilter: '',
    setUserIdFilter: vi.fn(),
    completionMin: 0,
    setCompletionMin: vi.fn(),
    filteredParticipantIds: demographicScope.filteredParticipantIds,
  }),
}));

vi.mock('../../shared/Filters', () => ({ Filters: () => null }));

import { ImplicitAssociationResults } from '../ImplicitAssociationResults';

getResults.mockImplementation(async (_researchId: string, _stageId?: string, scope: { participantIds?: readonly string[] } = {}) => ({
  modules: [scope.participantIds ? reliableOnlyModule : objectsComparingModule],
}));

describe('ImplicitAssociationResults — Objects Comparing', () => {
  beforeEach(() => {
    demographicScope.filteredParticipantIds = null;
    getResults.mockClear();
  });

  it('shows the choice share per object and the per-attribute breakdown', async () => {
    render(<ImplicitAssociationResults researchId="research-1" />);
    expect(await screen.findByText('% Positivo por atributo')).toBeInTheDocument();
    expect(screen.getAllByText('Positivo:').length).toBeGreaterThan(0);
    expect(screen.getByText(/81% — Fuerte/)).toBeInTheDocument();
  });

  it('switches the attribute breakdown between places with tabs', async () => {
    render(<ImplicitAssociationResults researchId="research-1" />);
    const curacavi = await screen.findByRole('tab', { name: 'Curacaví' });
    expect(screen.getByRole('tab', { name: 'Chicureo' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Chicureo: % de Positivo y Negativo en cada uno de los 1 atributos');
    fireEvent.click(curacavi);
    expect(curacavi).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Curacaví: % de Positivo y Negativo');
  });

  it('shows everyone by default and recomputes with only reliable participants on demand', async () => {
    render(<ImplicitAssociationResults researchId="research-1" />);
    const everyone = await screen.findByRole('button', { name: 'Todos (3)' });
    expect(everyone).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/1 fiables · 1 siempre la misma respuesta · 1 demasiado rápidas · se muestran 3 de 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Solo fiables (1)' }));
    expect(await screen.findByText(/62% — Media/)).toBeInTheDocument();
    expect(getResults).toHaveBeenLastCalledWith('research-1', undefined, { moduleId: 'module-1', participantIds: ['p-reliable'] });
    expect(screen.getByText(/se muestran 1 de 3/)).toBeInTheDocument();
  });

  it('recomputes the module for the demographic filter and counts only those participants', async () => {
    demographicScope.filteredParticipantIds = new Set(['p-reliable', 'p-same']);
    render(<ImplicitAssociationResults researchId="research-1" />);
    expect(await screen.findByText(/62% — Media/)).toBeInTheDocument();
    expect(getResults).toHaveBeenLastCalledWith('research-1', undefined, { moduleId: 'module-1', participantIds: ['p-reliable', 'p-same'] });
    expect(screen.getByRole('button', { name: 'Todos (2)' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Solo fiables (1)' }));
    await vi.waitFor(() => expect(getResults).toHaveBeenLastCalledWith('research-1', undefined, { moduleId: 'module-1', participantIds: ['p-reliable'] }));
  });

  it('says no participant matches instead of drawing empty charts when the filter leaves nobody', async () => {
    demographicScope.filteredParticipantIds = new Set();
    render(<ImplicitAssociationResults researchId="research-1" />);
    expect(await screen.findByText('Ningún participante cumple los filtros activos')).toBeInTheDocument();
    expect(screen.queryByText('% Positivo por atributo')).not.toBeInTheDocument();
    expect(getResults).toHaveBeenCalledTimes(1);
  });
});
