import { describe, expect, it } from 'vitest';
import { formatParticipantLabel } from '../participantLabel';

describe('formatParticipantLabel', () => {
  it('shows kiosk sessions as usuario', () => {
    expect(formatParticipantLabel('kiosk-12')).toBe('usuario-12');
  });

  it('leaves panel participant ids untouched', () => {
    expect(formatParticipantLabel('abc-kiosk-1')).toBe('abc-kiosk-1');
  });
});
