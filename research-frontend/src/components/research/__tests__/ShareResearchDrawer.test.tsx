import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/api/client', () => ({
    default: {
        get: vi.fn().mockResolvedValue({ collaborators: [{ id: 'c1', userId: 'u2', email: 'ana@x.com', firstName: null, lastName: null, permission: 'viewer', createdAt: '' }] }),
        post: vi.fn().mockResolvedValue({}),
        delete: vi.fn(),
    },
}));

import apiClient from '../../../services/api/client';
import { ShareResearchDrawer } from '../ShareResearchDrawer';

describe('ShareResearchDrawer', () => {
    beforeEach(() => vi.mocked(apiClient.post).mockClear());

    it('adds a collaborator as editor by default', async () => {
        render(<ShareResearchDrawer isOpen onClose={vi.fn()} researchId="r1" isOwner />);

        fireEvent.change(screen.getByPlaceholderText('email@example.com'), { target: { value: 'bob@x.com' } });
        fireEvent.click(screen.getByRole('button', { name: /Add/ }));

        await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/research/r1/collaborators', { email: 'bob@x.com', permission: 'editor' }));
    });

    it('adds a view-only collaborator when chosen', async () => {
        render(<ShareResearchDrawer isOpen onClose={vi.fn()} researchId="r1" isOwner />);

        fireEvent.change(screen.getByPlaceholderText('email@example.com'), { target: { value: 'bob@x.com' } });
        fireEvent.click(screen.getByText('Can edit'));
        fireEvent.click(screen.getByText('View only'));
        fireEvent.click(screen.getByRole('button', { name: /Add/ }));

        await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/research/r1/collaborators', { email: 'bob@x.com', permission: 'viewer' }));
    });

    it('labels each existing collaborator with its permission', async () => {
        render(<ShareResearchDrawer isOpen onClose={vi.fn()} researchId="r1" isOwner />);

        expect(await screen.findByText('ana@x.com')).toBeInTheDocument();
        expect(screen.getAllByText('View only').length).toBeGreaterThan(0);
    });
});
