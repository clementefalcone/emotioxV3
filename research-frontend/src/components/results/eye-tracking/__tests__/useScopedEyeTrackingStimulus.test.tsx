import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { useScopedEyeTrackingStimulus } from '../useScopedEyeTrackingStimulus';
import { getEyeTrackingResults } from '../../../../services/analytics.service';

vi.mock('../../../../services/analytics.service', () => ({
  getEyeTrackingResults: vi.fn().mockResolvedValue({ stimuli: [{ moduleId: 'mod-1', aois: [{ id: 'aoi-1' }] }] }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('useScopedEyeTrackingStimulus', () => {
  it('asks the backend for the module computed with exactly the included participants', async () => {
    const { result } = renderHook(
      () => useScopedEyeTrackingStimulus({ researchId: 'r-1', stageId: 's-1', moduleId: 'mod-1', includedParticipantIds: ['kiosk-2', 'kiosk-1'] }),
      { wrapper },
    );

    await waitFor(() => expect(result.current?.moduleId).toBe('mod-1'));
    expect(getEyeTrackingResults).toHaveBeenCalledWith('r-1', 's-1', { moduleId: 'mod-1', participantIds: ['kiosk-1', 'kiosk-2'] });
  });
});
