import { describe, it, expect } from 'vitest';
import { buildExpressionProtocol, EXPRESSIONS, ROUND_COUNT } from '../protocol';

describe('buildExpressionProtocol', () => {
  const steps = buildExpressionProtocol();

  it('starts with a neutral face, before any expression', () => {
    expect(steps[0].kind).toBe('neutral');
  });

  it('asks for every expression at the three intensities in every round', () => {
    for (let round = 1; round <= ROUND_COUNT; round++) {
      for (const expression of EXPRESSIONS) {
        const intensities = steps
          .filter(step => step.round === round && step.label === expression.label)
          .map(step => step.intensity);
        expect(intensities).toEqual(['suave', 'medio', 'maximo']);
      }
    }
  });

  it('returns to a relaxed face after every expression and head pose', () => {
    steps.forEach((step, index) => {
      if (step.kind === 'expression' || step.kind === 'head-pose') expect(steps[index + 1].kind).toBe('rest');
    });
  });

  it('reverses the expression order in the second round to separate order from expression', () => {
    const firstExpressionOf = (round: number) => steps.find(step => step.round === round && step.kind === 'expression')?.label;
    expect(firstExpressionOf(1)).toBe(EXPRESSIONS[0].label);
    expect(firstExpressionOf(2)).toBe(EXPRESSIONS[EXPRESSIONS.length - 1].label);
  });
});
