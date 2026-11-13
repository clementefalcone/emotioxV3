import { describe, expect, it } from 'vitest';
import { classifyEmotionPresence } from '../emotionScenario';

describe('classifyEmotionPresence', () => {
  it('calls an emotion active above 3%, secondary from 2% to 2.99%, and ignores it below', () => {
    expect(classifyEmotionPresence(3.01)).toBe('active');
    expect(classifyEmotionPresence(3)).toBe('secondary');
    expect(classifyEmotionPresence(2.99)).toBe('secondary');
    expect(classifyEmotionPresence(2)).toBe('secondary');
    expect(classifyEmotionPresence(1.99)).toBeNull();
  });
});
