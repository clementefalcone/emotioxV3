import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CaptureErrorBadges } from '../CaptureErrorBadges';

describe('CaptureErrorBadges', () => {
    it('shows one labelled warning per capture failure', () => {
        render(<CaptureErrorBadges errors={['camera-denied', 'mediapipe-failed']} />);

        expect(screen.getByText('Camera denied')).toBeTruthy();
        expect(screen.getByText('MediaPipe failed').closest('span')?.getAttribute('title')).toContain('face model did not load');
    });

    it('shows nothing for a page without failures', () => {
        const { container } = render(<CaptureErrorBadges errors={[]} />);

        expect(container.textContent).toBe('');
    });
});
