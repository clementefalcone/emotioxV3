import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { GazePrecisionNotice } from '../GazePrecisionNotice';
import { summarizeGazePrecision } from '../gazePrecisionSummary';
import type { EyeTrackingParticipant } from '../../../../services/analytics.service';

const participant = (participantId: string, deviceType: string, calibrationErrorPercent: number | null): EyeTrackingParticipant => ({
    participantId, deviceType, calibrationErrorPercent, calibrationQuality: 'mediapipe-13pt', calibrationRmsePx: null,
    integrityScore: 1, totalFixations: 10, totalDwellTime: 1000, qualityGrade: 'low',
});

const participants = [
    participant('d1', 'desktop', 28), participant('d2', 'desktop', 30), participant('d3', 'desktop', 34),
    participant('m1', 'mobile', 38), participant('m2', 'mobile', 40),
    participant('old', 'desktop', null),
];

describe('summarizeGazePrecision', () => {
    it('reports the median error per device from included sessions and flags AOIs narrower than it', () => {
        const summary = summarizeGazePrecision(participants, new Set(['m2']), [{ label: 'Logo', width: 10 }, { label: 'Banner', width: 60 }]);
        expect(summary.devices).toEqual([{ label: 'Escritorio', errorPercent: 30 }, { label: 'Móvil', errorPercent: 38 }]);
        expect(summary.narrowAoiLabels).toEqual(['Logo']);
    });
});

describe('GazePrecisionNotice', () => {
    it('shows the margin per device and warns about narrow AOIs', () => {
        render(<GazePrecisionNotice participants={participants} excludedParticipants={new Set()} aois={[{ label: 'Logo', width: 10 }]} />);
        expect(screen.getByText(/Escritorio ±30 % · Móvil ±40 % del ancho de pantalla/)).toBeTruthy();
        expect(screen.getByText(/«Logo» es más estrecha que ese margen/)).toBeTruthy();
    });

    it('stays hidden when no session has a measured error', () => {
        const { container } = render(<GazePrecisionNotice participants={[participant('old', 'desktop', null)]} excludedParticipants={new Set()} aois={[]} />);
        expect(container.textContent).toBe('');
    });
});
