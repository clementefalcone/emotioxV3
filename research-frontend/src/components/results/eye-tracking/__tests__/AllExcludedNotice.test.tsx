import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AllExcludedNotice } from '../AllExcludedNotice';

describe('AllExcludedNotice', () => {
  it('says how many participants were excluded and lets the researcher include them', () => {
    const onIncludeAll = vi.fn();
    render(<AllExcludedNotice participantCount={5} onIncludeAll={onIncludeAll} />);

    expect(screen.getByText(/Los 5 participantes quedaron fuera del filtro de fiabilidad/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Incluir todos' }));
    expect(onIncludeAll).toHaveBeenCalledTimes(1);
  });
});
