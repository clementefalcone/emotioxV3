import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ResearchBuilderHeader } from '../ResearchBuilderHeader';
import type { Module, Research } from '../../../services/research.service';

const research = { id: 'r1', name: 'Study', status: 'draft', research_type_id: 't1', created_at: '', updated_at: '' } as Research;
const activeModule = { id: 'm1', name: 'NPS', order_index: 0, questions: [] } as unknown as Module;

const renderHeader = (isReadOnly: boolean) => render(
    <ResearchBuilderHeader research={research} activeModule={activeModule} isSettings={false} isSaving={false} onSave={vi.fn()} isReadOnly={isReadOnly} />,
);

describe('ResearchBuilderHeader', () => {
    it('offers Save Changes to an editor', () => {
        renderHeader(false);
        expect(screen.getByRole('button', { name: /Save Changes/ })).toBeInTheDocument();
    });

    it('hides Save Changes from a view-only user', () => {
        renderHeader(true);
        expect(screen.queryByRole('button', { name: /Save Changes/ })).not.toBeInTheDocument();
    });
});
