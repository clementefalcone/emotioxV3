import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEnterToContinue } from '../useEnterToContinue';

const pressEnter = (target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

describe('useEnterToContinue', () => {
  it('continues on Enter once the participant has answered', () => {
    const onContinue = vi.fn();
    const { rerender } = renderHook(({ canContinue }) => useEnterToContinue(canContinue, onContinue), {
      initialProps: { canContinue: false },
    });

    pressEnter();
    expect(onContinue).not.toHaveBeenCalled();

    rerender({ canContinue: true });
    pressEnter();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('keeps Enter for new lines inside a textarea', () => {
    const onContinue = vi.fn();
    renderHook(() => useEnterToContinue(true, onContinue));
    const textarea = document.body.appendChild(document.createElement('textarea'));

    pressEnter(textarea);

    expect(onContinue).not.toHaveBeenCalled();
    textarea.remove();
  });
});
