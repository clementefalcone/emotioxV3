import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../services/api/client', () => ({ default: { get } }));
vi.mock('../../services/analytics.service', () => ({
    getDemographicResponses: () => Promise.resolve({ participants: [], demographicTypes: [] }),
}));

import { useResultsFilter } from '../useResultsFilter';
import { useResultsFilterStore } from '../../stores/useResultsFilterStore';

const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('useResultsFilter', () => {
    beforeEach(() => {
        useResultsFilterStore.setState({ filtersByResearch: {} });
        get.mockResolvedValue([{ id: 'kiosk-1', progress: 100 }, { id: 'kiosk-2', progress: 40 }]);
    });

    it('filters by user ID even when the study has no demographic responses', async () => {
        const { result } = renderHook(() => useResultsFilter('r-1'), { wrapper });
        await waitFor(() => expect(get).toHaveBeenCalled());

        act(() => result.current.setUserIdFilter('kiosk-2'));

        await waitFor(() => expect(result.current.filteredParticipantIds).toEqual(new Set(['kiosk-2'])));
    });

    it('shares the active filters between every results section of the same study', async () => {
        const { result } = renderHook(() => ({ section: useResultsFilter('r-1'), page: useResultsFilter('r-1') }), { wrapper });

        act(() => result.current.section.setCompletionMin(90));

        await waitFor(() => expect(result.current.page.filteredParticipantIds).toEqual(new Set(['kiosk-1'])));
    });
});
