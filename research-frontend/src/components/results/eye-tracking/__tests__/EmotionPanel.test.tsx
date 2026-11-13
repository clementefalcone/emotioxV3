import { fireEvent, render, screen, within } from '@testing-library/react';
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
    meanIntensity: distributionOf({ joy: 40, surprise: 10, sadness: 4, neutral: 46 }),
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

    it('scores EmScore from mean intensity, leaving neutral out of the penalty', () => {
        render(<EmotionPanel emotions={buildEmotions()} />);
        const score = screen.getByText('EmScore').parentElement?.nextElementSibling;
        expect(score?.textContent).toBe('106.0');
        expect(score?.className).toContain('text-emerald-600');
    });

    it('shows a negative EmScore in red for a fear/disgust-dominated stimulus', () => {
        render(<EmotionPanel emotions={buildEmotions({
            distribution: distributionOf({ disgust: 60, fear: 20, neutral: 20 }),
            meanIntensity: distributionOf({ disgust: 60, fear: 20, neutral: 20 }),
            dominantEmotion: 'disgust',
        })} />);
        const score = screen.getByText('EmScore').parentElement?.nextElementSibling;
        expect(score?.textContent).toBe('-140.0');
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

    it('illustrates every action unit with the avatar of its typical emotion in its tooltip', () => {
        render(<EmotionPanel emotions={buildEmotions()} />);
        expect(screen.getAllByRole('img').map(face => face.getAttribute('alt'))).toEqual([
            'AU1 Inner Brow Raise', 'AU2 Outer Brow Raise', 'AU4 Brow Lowerer', 'AU6 Cheek Raiser', 'AU12 Lip Corner Pull',
            'AU15 Lip Corner Depress', 'AU20 Lip Stretcher', 'AU25 Lips Part', 'AU26 Jaw Drop',
        ]);
        expect(screen.getAllByText(/^Típico de /).map(caption => caption.textContent)).toEqual([
            'Típico de Sadness', 'Típico de Surprise', 'Típico de Anger', 'Típico de Joy', 'Típico de Joy',
            'Típico de Sadness', 'Típico de Fear', 'Típico de Fear', 'Típico de Surprise',
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

    it('shows the avatar of a micro-expression emotion on hover and hides it on leave', () => {
        render(<EmotionPanel emotions={buildEmotions({
            microExpressions: {
                total: 1, briefCount: 1, microCount: 0,
                byEmotion: { disgust: 1 },
                events: [{ participantId: 'p-1', emotion: 'disgust', durationMs: 300, startTimestamp: 500, category: 'brief', peakConfidence: 0.8 }],
            },
        })} />);
        const tableBadge = within(screen.getAllByRole('row').find(row => row.textContent?.includes('0.5s')) as HTMLElement).getByText('Disgust');

        fireEvent.mouseEnter(tableBadge);

        expect(within(screen.getByRole('tooltip')).getByRole('img', { name: 'Disgust' })).toBeInTheDocument();
        fireEvent.mouseLeave(tableBadge);
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('renames the emotions to the FMCG scenario and back', () => {
        render(<EmotionPanel emotions={buildEmotions()} />);

        fireEvent.click(screen.getByRole('button', { name: 'FMCG' }));

        expect(screen.getAllByText('Comfort').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Curiosity').length).toBeGreaterThan(0);
        expect(screen.queryByText('Joy')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'UX/UI' }));
        expect(screen.queryByText('Comfort')).not.toBeInTheDocument();
    });

    it('explains each FMCG category and marks active and secondary emotions', () => {
        render(<EmotionPanel emotions={buildEmotions({ distribution: distributionOf({ neutral: 90, joy: 5, surprise: 2.5, sadness: 1, disgust: 1.5 }) })} />);

        fireEvent.click(screen.getByRole('button', { name: 'FMCG' }));

        expect(screen.getByText('Comodidad y/o Nostalgia')).toBeInTheDocument();
        expect(screen.getByText('Disonancia y/o Valores en conflicto').parentElement?.textContent).toContain('Emoción negativa');
        expect(screen.getAllByText('Activa')).toHaveLength(1);
        expect(screen.getAllByText('Secundaria')).toHaveLength(1);
    });

    it('hides the micro-expressions section when none were detected', () => {
        render(<EmotionPanel emotions={buildEmotions()} />);
        expect(screen.queryByText('Micro-Expressions')).not.toBeInTheDocument();
    });
});
