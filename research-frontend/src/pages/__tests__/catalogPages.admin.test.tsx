import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ToastProvider } from '../../contexts/ToastContext';
import { useAuthStore } from '../../stores/auth.store';
import { ResearchTypesPage } from '../research-types/ResearchTypesPage';
import { ResearchTechniquesPage } from '../research-techniques/ResearchTechniquesPage';
import { ModulesPage } from '../modules/ModulesPage';

vi.mock('../../services/researchTypes.service', () => ({
    researchTypesService: { list: vi.fn().mockResolvedValue({ researchTypes: [{ id: 'r1', name: 'Survey', created_at: '2026-01-01' }] }) },
}));
vi.mock('../../services/researchTechniques.service', () => ({
    researchTechniquesService: { list: vi.fn().mockResolvedValue({ researchTechniques: [{ id: 't1', name: 'Biometric', description: 'd', created_at: '2026-01-01' }] }) },
}));
vi.mock('../../services/stageTemplates.service', () => ({
    stageTemplatesService: { getAll: vi.fn().mockResolvedValue([{ id: 's1', name: 'SmartVOC', modules: [{ id: 'm1', name: 'NPS' }] }]) },
}));
vi.mock('../../services/moduleTemplates.service', () => ({
    moduleTemplatesService: { getUsage: vi.fn().mockResolvedValue({ count: 0, researches: [] }) },
}));
vi.mock('../../hooks/useModuleTemplatesQuery', () => ({
    useModuleTemplates: () => ({ data: [{ id: 'm1', name: 'NPS' }], isLoading: false, error: null }),
    useModuleTemplate: () => ({ data: undefined }),
    useDeleteModuleTemplate: () => ({ mutateAsync: vi.fn() }),
}));

const renderAs = (role: string, page: ReactNode) => {
    useAuthStore.setState({ user: { role } } as never);
    render(<ToastProvider><MemoryRouter>{page}</MemoryRouter></ToastProvider>);
};

const writeControls = () => [
    ...screen.queryAllByTitle(/^(Edit|Delete|Duplicate|Assign techniques)$/),
    ...screen.queryAllByRole('button', { name: /New Type|New Technique|Create Technique|New Module/ }),
];

describe('catalog pages — write controls', () => {
    it.each([
        ['research types', <ResearchTypesPage />, 'Survey'],
        ['research techniques', <ResearchTechniquesPage />, 'Biometric'],
        ['modules', <ModulesPage />, 'NPS'],
    ])('shows %s read-only to a researcher', async (_, page, itemName) => {
        renderAs('researcher', page);

        expect(await screen.findByText(itemName)).toBeInTheDocument();
        expect(writeControls()).toHaveLength(0);
    });

    it('keeps write controls for an admin', async () => {
        renderAs('admin', <ResearchTypesPage />);

        expect(await screen.findByText('Survey')).toBeInTheDocument();
        expect(writeControls().length).toBeGreaterThan(0);
    });
});
