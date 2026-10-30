import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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
};

vi.mock('../../../../services/analytics.service', () => ({
  getImplicitAssociationResults: vi.fn(async () => ({ modules: [objectsComparingModule] })),
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
    filteredParticipantIds: null,
  }),
}));

vi.mock('../../shared/Filters', () => ({ Filters: () => null }));

import { ImplicitAssociationResults } from '../ImplicitAssociationResults';

describe('ImplicitAssociationResults — Objects Comparing', () => {
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
});
