import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { GazePrecisionNotice } from '../GazePrecisionNotice';
import { summarizeGazePrecision } from '../gazePrecisionSummary';
import type { EyeTrackingParticipant } from '../../../../services/analytics.service';

const participant = (participantId: string, deviceType: string, calibrationErrorPercent: number | null): EyeTrackingParticipant => ({
    participantId, deviceType, calibrationErrorPercent, faceDetectedPercent: null, calibrationQuality: 'mediapipe-13pt', calibrationRmsePx: null,
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
    it('explains the gaze deviation per device in plain words', () => {
        render(<GazePrecisionNotice participants={participants} excludedParticipants={new Set()} aois={[]} />);
        expect(screen.getByText('La mirada registrada puede desviarse hasta un 30 % del ancho de la pantalla en escritorio y un 40 % en móvil.')).toBeTruthy();
    });

    it('counts the zones narrower than that deviation instead of listing file names', () => {
        render(<GazePrecisionNotice participants={participants} excludedParticipants={new Set()} aois={[{ label: 'Logo', width: 10 }, { label: 'Banner', width: 60 }]} />);
        const warning = screen.getByText('1 de 2 zonas es más estrecha que esa desviación: lee su porcentaje como una tendencia, no como un valor exacto.');
        expect(warning.getAttribute('title')).toBe('Logo');
    });

    it('says "todas las zonas" when every zone is narrower', () => {
        render(<GazePrecisionNotice participants={participants} excludedParticipants={new Set()} aois={[{ label: 'A', width: 10 }, { label: 'B', width: 20 }]} />);
        expect(screen.getByText('Todas las zonas (2) son más estrechas que esa desviación: lee sus porcentajes como una tendencia, no como un valor exacto.')).toBeTruthy();
    });

    it('stays hidden when no session has a measured error', () => {
        const { container } = render(<GazePrecisionNotice participants={[participant('old', 'desktop', null)]} excludedParticipants={new Set()} aois={[]} />);
        expect(container.textContent).toBe('');
    });

    it('shows how often the face was found per device', () => {
        const tracked = [
            { ...participant('d1', 'desktop', null), faceDetectedPercent: 96 },
            { ...participant('m1', 'mobile', null), faceDetectedPercent: 81.4 },
        ];
        render(<GazePrecisionNotice participants={tracked} excludedParticipants={new Set()} aois={[]} />);
        expect(screen.getByText('La cámara detectó el rostro el 96 % del tiempo en escritorio y el 81 % en móvil.')).toBeTruthy();
        expect(screen.queryByText(/puede desviarse/)).toBeNull();
    });
});
