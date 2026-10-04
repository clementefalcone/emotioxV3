import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useResearchForm } from '../useResearchForm';
import { useAuthStore } from '../../stores/auth.store';
import { ToastProvider } from '../../contexts/ToastContext';

vi.mock('../../services/researchTypes.service', () => ({
    researchTypesService: { list: vi.fn().mockResolvedValue([]), getTechniquesByType: vi.fn().mockResolvedValue([]) },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

const typeNewClient = (role: string) => {
    useAuthStore.setState({ user: { role } } as never);
    const { result } = renderHook(() => useResearchForm(), { wrapper });
    act(() => {
        result.current.setFormData((prev) => ({ ...prev, name: 'Study', enterpriseName: 'Brand new client', enterpriseId: '' }));
    });
    act(() => { result.current.handleNextStep(); });
    return result;
};

describe('useResearchForm — client selection', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('makes a researcher pick an existing client instead of creating one', () => {
        const result = typeNewClient('researcher');

        expect(result.current.currentStep).toBe(0);
        expect(result.current.formErrors.enterpriseId).toBe('Select an existing client');
    });

    it('lets an admin continue with a new client name', () => {
        const result = typeNewClient('admin');

        expect(result.current.currentStep).toBe(1);
    });
});
