import { render, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SetupPhase } from '../SetupPhase';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}));

describe('SetupPhase camera preview', () => {
    it('attaches the camera stream to the preview video once it mounts', async () => {
        vi.useFakeTimers();
        const stream = { active: true } as unknown as MediaStream;
        const cameraRef = { current: { srcObject: stream } as HTMLVideoElement };

        const { container } = render(
            <SetupPhase
                checks={[false, false, false, false]}
                allChecked={false}
                onToggleCheck={vi.fn()}
                onReady={vi.fn()}
                cameraRef={cameraRef}
            />
        );

        await act(async () => { vi.advanceTimersByTime(250); });

        const preview = container.querySelector('video');
        expect(preview).not.toBeNull();
        expect(preview?.srcObject).toBe(stream);
        vi.useRealTimers();
    });
});
