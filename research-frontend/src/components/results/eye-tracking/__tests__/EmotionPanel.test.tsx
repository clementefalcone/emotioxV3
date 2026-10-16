import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { EmotionPanel } from '../EmotionPanel';
import type { EmotionAggregation, EkmanEmotion } from '../../../../services/analytics.service';

const distributionOf = (values: Partial<Record<EkmanEmotion, number>>): Record<EkmanEmotion, number> => ({
    joy: 0, sadness: 0, surprise: 0, anger: 0, disgust: 0, fear: 0, neutral: 0, ...values,
});

const buildEmotions = (overrides: Partial<EmotionAggregation> = {}): EmotionAggregation => ({
    enabled: true,
    totalSamples: 1200,
    distribution: distributionOf({ joy: 50, surprise: 20, neutral: 30 }),
    dominantEmotion: 'joy',
    avgConfidence: 0.82,
    perParticipant: [
        { participantId: 'p-1', dominantEmotion: 'joy', sampleCount: 700, distribution: distributionOf({ joy: 100 }) },
        { participantId: 'p-2', dominantEmotion: 'neutral', sampleCount: 500, distribution: distributionOf({ neutral: 100 }) },
    ],
    timeline: [
        { timestamp: 0, emotion: 'joy', confidence: 0.9, actionUnits: { AU6: 0.5, AU12: 0.7 } },
        { timestamp: 1000, emotion: 'neutral', confidence: 0.6, actionUnits: { AU6: 0.1, AU12: 0.1 } },
    ],
    ...overrides,
});

const moodValue = (label: string) => parseFloat(screen.getByText(label).previousElementSibling?.textContent ?? 'NaN');

describe('EmotionPanel', () => {
    it('says emotion recognition was off when the stimulus did not enable it', () => {
        render(<EmotionPanel emotions={buildEmotions({ enabled: false, totalSamples: 0 })} />);
        expect(screen.getByText('Emotion recognition was not enabled for this stimulus.')).toBeInTheDocument();
        expect(screen.queryByText('EmScore')).not.toBeInTheDocument();
    });

    it('says no emotions were detected when enabled but no samples were recorded', () => {
        render(<EmotionPanel emotions={buildEmotions({ totalSamples: 0 })} />);
        expect(screen.getByText('No se detectaron emociones en las respuestas registradas.')).toBeInTheDocument();
        expect(screen.queryByText('EmScore')).not.toBeInTheDocument();
    });

    it('shows the dominant emotion, sample count and average confidence', () => {
        render(<EmotionPanel emotions={buildEmotions()} />);
        expect(screen.getByText(/1[.,]?200 muestras/)).toBeInTheDocument();
        expect(screen.getByText(/82% confianza promedio/)).toBeInTheDocument();
    });

    it('computes EmScore as 2(C+Q) + 1.5E - (W+U) - 2T', () => {
        render(<EmotionPanel emotions={buildEmotions()} />);
        const score = screen.getByText('EmScore').parentElement?.nextElementSibling;
        expect(score?.textContent).toBe('162.5');
        expect(score?.className).toContain('text-emerald-600');
    });

    it('shows a negative EmScore in red for a fear/disgust-dominated stimulus', () => {
        render(<EmotionPanel emotions={buildEmotions({
            distribution: distributionOf({ disgust: 60, fear: 20, neutral: 20 }),
            dominantEmotion: 'disgust',
        })} />);
        const score = screen.getByText('EmScore').parentElement?.nextElementSibling;
        expect(score?.textContent).toBe('-160.0');
        expect(score?.className).toContain('text-red-600');
    });

    it('computes each mood state as the average of its three emotion percentages', () => {
        render(<EmotionPanel emotions={buildEmotions()} />);
        expect(moodValue('Frustración')).toBe(10);
        expect(moodValue('Interés')).toBe(33.3);
        expect(moodValue('Concentración')).toBe(10);
    });

    it.each([
        ['all neutral', distributionOf({ neutral: 100 })],
        ['all joy', distributionOf({ joy: 100 })],
        ['all sadness', distributionOf({ sadness: 100 })],
    ])('keeps every mood state between 0 and 100 percent (%s)', (_, distribution) => {
        render(<EmotionPanel emotions={buildEmotions({ distribution })} />);
        for (const mood of ['Frustración', 'Interés', 'Concentración']) {
            expect(moodValue(mood)).toBeGreaterThanOrEqual(0);
            expect(moodValue(mood)).toBeLessThanOrEqual(100);
        }
    });

    it('lists each participant with its dominant emotion and sample count', () => {
        render(<EmotionPanel emotions={buildEmotions()} />);
        expect(screen.getByText('p-1')).toBeInTheDocument();
        expect(screen.getByText('p-2')).toBeInTheDocument();
        expect(screen.getByText('700')).toBeInTheDocument();
        expect(screen.getByText('500')).toBeInTheDocument();
    });

    it('renders the timeline span and average action units', () => {
        render(<EmotionPanel emotions={buildEmotions()} />);
        expect(screen.getByText('Emotion Timeline')).toBeInTheDocument();
        expect(screen.getAllByText('1.0s').length).toBeGreaterThan(0);
        expect(screen.getByText('Average Action Unit Activation')).toBeInTheDocument();
    });

    it('illustrates every action unit with a face in its tooltip', () => {
        render(<EmotionPanel emotions={buildEmotions()} />);
        expect(screen.getAllByRole('img').map(face => face.getAttribute('aria-label'))).toEqual([
            'AU1 Inner Brow Raise', 'AU2 Outer Brow Raise', 'AU4 Brow Lowerer', 'AU6 Cheek Raiser', 'AU12 Lip Corner Pull',
            'AU15 Lip Corner Depress', 'AU20 Lip Stretcher', 'AU25 Lips Part', 'AU26 Jaw Drop',
        ]);
    });

    it('explains missing action units when no landmark data was captured', () => {
        render(<EmotionPanel emotions={buildEmotions({
            timeline: [{ timestamp: 0, emotion: 'joy', confidence: 0.9, actionUnits: {} as EmotionAggregation['timeline'][number]['actionUnits'] }],
        })} />);
        expect(screen.getByText(/No Action Unit data available/)).toBeInTheDocument();
    });

    it('lists micro-expressions in time order with their counts', () => {
        render(<EmotionPanel emotions={buildEmotions({
            microExpressions: {
                total: 2, briefCount: 1, microCount: 1,
                byEmotion: { fear: 1, surprise: 1 },
                events: [
                    { participantId: 'p-1', emotion: 'surprise', durationMs: 300, startTimestamp: 2500, category: 'brief', peakConfidence: 0.8 },
                    { participantId: 'p-2', emotion: 'fear', durationMs: 120, startTimestamp: 400, category: 'micro', peakConfidence: 0.7 },
                ],
            },
        })} />);
        expect(screen.getByText('2 detected')).toBeInTheDocument();
        const rows = screen.getAllByRole('row').filter(r => r.textContent?.includes('ms'));
        expect(rows.map(r => r.textContent)).toEqual([
            expect.stringContaining('0.4s'),
            expect.stringContaining('2.5s'),
        ]);
    });

    it('hides the micro-expressions section when none were detected', () => {
        render(<EmotionPanel emotions={buildEmotions()} />);
        expect(screen.queryByText('Micro-Expressions')).not.toBeInTheDocument();
    });
});
