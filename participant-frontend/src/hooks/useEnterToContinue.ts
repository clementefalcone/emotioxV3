import { useEffect } from 'react';

export const useEnterToContinue = (canContinue: boolean, onContinue: () => void): void => {
  useEffect(() => {
    if (!canContinue) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      onContinue();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canContinue, onContinue]);
};
