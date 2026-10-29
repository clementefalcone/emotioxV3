import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ReliabilityFilter } from '../ReliabilityFilter';

const participants = [
  { participantId: 'p-good', qualityGrade: 'good' as const },
  { participantId: 'p-fair', qualityGrade: 'fair' as const },
  { participantId: 'p-low-1', qualityGrade: 'low' as const },
  { participantId: 'p-low-2', qualityGrade: 'low' as const },
];

const renderFilter = (excluded: Set<string>) => {
  const onChange = vi.fn();
  render(<ReliabilityFilter participants={participants} excludedParticipants={excluded} onChange={onChange} />);
  return onChange;
};

describe('ReliabilityFilter', () => {
  it('shows how many participants each level keeps and marks "Todos" active when nobody is excluded', () => {
    renderFilter(new Set());

    expect(screen.getByRole('button', { name: 'Todos (4)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Regular o mejor (2)' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Solo buena (1)' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('excludes the participants below the chosen level', () => {
    const onChange = renderFilter(new Set());

    fireEvent.click(screen.getByRole('button', { name: 'Regular o mejor (2)' }));
    expect(onChange).toHaveBeenCalledWith(new Set(['p-low-1', 'p-low-2']));

    fireEvent.click(screen.getByRole('button', { name: 'Solo buena (1)' }));
    expect(onChange).toHaveBeenLastCalledWith(new Set(['p-fair', 'p-low-1', 'p-low-2']));
  });

  it('marks no level active after a manual selection that matches none', () => {
    renderFilter(new Set(['p-good']));

    expect(screen.getAllByRole('button').every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true);
  });
});
