import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useParticipantStore } from '../../stores/useParticipantStore';
import type { Module } from '../../services/public.service';

vi.hoisted(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => { storage.set(k, v); },
    removeItem: (k: string) => { storage.delete(k); },
  });
});

const { questionModule } = vi.hoisted(() => ({
  questionModule: (id: string, title: string) => ({
    id,
    name: 'Short Text',
    order_index: id === 'q1' ? 0 : 1,
    structure: { components: [{ id: 'question-title', type: 'text', value: title }] },
  }),
}));

vi.mock('../../services/public.service', () => ({
  publicService: {
    getParticipationMode: vi.fn().mockResolvedValue('panel'),
    getResearch: vi.fn().mockResolvedValue({
      id: 'r1',
      stages: [{ id: 's1', name: 'Cognitive Tasks', order_index: 0, modules: [questionModule('q1', 'First question'), questionModule('q2', 'Second question')] }],
    }),
  },
}));

vi.mock('../../components/steps/DynamicStep', () => ({
  DynamicStep: ({ module }: { module: Module }) => (
    <div>
      <p>{`step:${module.id}`}</p>
      <button onClick={() => useParticipantStore.getState().saveResponse(module.id, 'answer', 'my answer')}>answer</button>
    </div>
  ),
}));

vi.mock('../../components/layout/DevSidebar', () => ({ DevSidebar: () => null }));
vi.mock('../../services/response.service', () => ({ responseService: {} }));

import { ResearchPage } from '../ResearchPage';

const pressEnter = () =>
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });

const renderStudy = () =>
  render(
    <MemoryRouter initialEntries={['/r1?preview=true']}>
      <Routes>
        <Route path="/:researchId" element={<ResearchPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('ResearchPage — Enter to continue', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/r1?preview=true');
    useParticipantStore.getState().clearAllResponses();
    useParticipantStore.getState().setCurrentStep('welcome');
  });

  it('does not continue before answering and continues with Enter right after answering', async () => {
    renderStudy();
    expect(await screen.findByText('step:q1')).toBeTruthy();

    pressEnter();
    expect(screen.getByText('step:q1')).toBeTruthy();

    fireEvent.click(screen.getByText('answer'));
    pressEnter();

    expect(await screen.findByText('step:q2')).toBeTruthy();
  });
});
