import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { EkmanEmotion } from '../../../../services/analytics.service';
import { EmotionCurveTimeline } from '../EmotionCurveTimeline';
import type { ParticipantEmotionSample } from '../emotionCurve';

const NO_EXPRESSIONS: Record<EkmanEmotion, number> = { joy: 0, surprise: 0, anger: 0, fear: 0, disgust: 0, sadness: 0, neutral: 0 };

const sample = (participantId: string, timestamp: number, expressions: Partial<Record<EkmanEmotion, number>>): ParticipantEmotionSample =>
  ({ participantId, timestamp, emotion: 'neutral', confidence: 1, valence: 0, arousal: 0, expressions: { ...NO_EXPRESSIONS, ...expressions } });

const SAMPLES = [
  sample('p-1', 0, { anger: 0.8, joy: 0.1, neutral: 0.1 }),
  sample('p-1', 1000, { anger: 0.9, joy: 0.05, neutral: 0.05 }),
  sample('p-2', 0, { joy: 0.6, anger: 0.2, neutral: 0.2 }),
  sample('p-2', 1000, { joy: 0.7, anger: 0.1, neutral: 0.2 }),
];

const observationText = () => screen.getByText(/predomina/).closest('p')?.textContent;

const renderTimeline = () => render(<EmotionCurveTimeline samples={SAMPLES} tracks={[]} zones={[]} />);

describe('EmotionCurveTimeline', () => {
  it('states which shown emotion leads the last two seconds and by how much', () => {
    renderTimeline();

    expect(observationText()).toBe('Observación: Anger predomina en los 2 segundos previos a 0:01, con una distancia de 14% de la siguiente más cercana.');
  });

  it('re-ranks the observation when an emotion is hidden', () => {
    renderTimeline();

    fireEvent.click(screen.getByRole('button', { name: 'Anger' }));

    expect(observationText()).toMatch(/^Observación: Joy predomina/);
    expect(screen.getByRole('button', { name: 'Anger' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('hides every series at once and offers to show them again', () => {
    renderTimeline();

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar todo' }));

    expect(screen.getByRole('button', { name: 'Mostrar todo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Valencia' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('draws one face presence bar per participant', () => {
    renderTimeline();

    expect(screen.getByTitle('p-1')).toBeInTheDocument();
    expect(screen.getByTitle('p-2')).toBeInTheDocument();
  });

  it('does not crown an emotion that is absent from the window', () => {
    render(<EmotionCurveTimeline samples={[sample('p-1', 0, { neutral: 1 })]} tracks={[]} zones={[]} />);

    expect(screen.getByText('Ninguna de las emociones visibles aparece en los 2 segundos previos a 0:00.')).toBeInTheDocument();
  });

  it('asks for an emotion when every emotion is hidden', () => {
    renderTimeline();

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar todo' }));

    expect(screen.getByText('Activa al menos una emoción para ver cuál predomina.')).toBeInTheDocument();
  });
});
