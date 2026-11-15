import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FixationParametersPanel } from '../FixationParametersPanel';

describe('FixationParametersPanel', () => {
  it('applies the edited parameters and leaves an empty end of window as the end of the exposure', () => {
    const onApply = vi.fn();
    render(<FixationParametersPanel parameters={null} onApply={onApply} />);

    fireEvent.click(screen.getByRole('button', { name: /Parámetros de fijación/ }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Duración mínima de fijación (ms)' }), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(onApply).toHaveBeenCalledWith({ windowStartS: 0, windowEndS: null, minDurationMs: 200, maxDurationMs: null, maxDispersionPercent: 6, mergeRangePercent: 0 });
  });

  it('goes back to the fixations recorded during the session', () => {
    const onApply = vi.fn();
    render(<FixationParametersPanel parameters={{ windowStartS: 1, windowEndS: 5, minDurationMs: 200, maxDurationMs: null, maxDispersionPercent: 4, mergeRangePercent: 0 }} onApply={onApply} />);

    expect(screen.getByText('Personalizados')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Parámetros de fijación/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Volver a las fijaciones originales' }));

    expect(onApply).toHaveBeenCalledWith(null);
  });
});
