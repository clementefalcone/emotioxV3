import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockQuery = vi.fn();
vi.mock('../../../config/database', () => ({
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: vi.fn(),
  },
}));

vi.mock('../research.helpers', () => ({
  buildOwnershipClause: vi.fn(() => ({
    clause: 'user_id = ?',
    params: ['user-1'],
  })),
}));

import { getParticipantsWithStatusInternal } from '../research-in-progress.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set up mock query responses for getParticipantsWithStatusInternal.
 * Call order:
 *   1. research check
 *   2. visible modules query (getVisibleModulesForProgress)
 *   3. participants query
 *   4. (optional) demographics query — only if conditional modules exist
 */
function setupQueries(opts: {
  modules?: Array<{ id: string; name: string; config?: any }>;
  participants?: Array<{
    id: string;
    name: string;
    email?: string;
    answered_modules: number;
    panel_status?: string | null;
    first_response?: Date | null;
    last_response?: Date | null;
  }>;
  demographics?: Array<{
    participant_id: string;
    demographic_type: string;
    demographic_value: string;
  }>;
}) {
  const modules = opts.modules ?? [
    { id: 'mod-1', name: 'CSAT', config: JSON.stringify({ structure: { components: [] } }) },
    { id: 'mod-2', name: 'NPS', config: JSON.stringify({ structure: { components: [] } }) },
  ];
  const participants = opts.participants ?? [];

  // 1. research check
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r-1' }] });
  // 2. visible modules (getVisibleModulesForProgress)
  mockQuery.mockResolvedValueOnce({ rows: modules });
  // 3. participants query
  mockQuery.mockResolvedValueOnce({ rows: participants });
  // 4. demographics (only queried if conditional modules exist)
  if (opts.demographics) {
    mockQuery.mockResolvedValueOnce({ rows: opts.demographics });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getParticipantsWithStatusInternal — status labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps panelStatus "overquota" to "Over quota"', async () => {
    setupQueries({
      participants: [{
        id: 'p1',
        name: 'Alice',
        answered_modules: 0,
        panel_status: 'overquota',
        first_response: null,
        last_response: null,
      }],
    });

    const result = await getParticipantsWithStatusInternal('r-1');

    expect(result[0].status).toBe('Over quota');
  });

  it('maps panelStatus "disqualified" to "Disqualified"', async () => {
    setupQueries({
      participants: [{
        id: 'p2',
        name: 'Bob',
        answered_modules: 1,
        panel_status: 'disqualified',
        first_response: new Date(),
        last_response: new Date(),
      }],
    });

    const result = await getParticipantsWithStatusInternal('r-1');

    expect(result[0].status).toBe('Disqualified');
  });

  it('shows "Completed" when all modules answered', async () => {
    const now = new Date();
    setupQueries({
      participants: [{
        id: 'p3',
        name: 'Carol',
        answered_modules: 2,
        panel_status: null,
        first_response: now,
        last_response: now,
      }],
    });

    const result = await getParticipantsWithStatusInternal('r-1');

    expect(result[0].status).toBe('Completed');
    expect(result[0].progress).toBe(100);
  });

  it('shows "Completed" when panelStatus is "responded"', async () => {
    const now = new Date();
    setupQueries({
      participants: [{
        id: 'p4',
        name: 'Dave',
        answered_modules: 1, // not all modules, but responded flag
        panel_status: 'responded',
        first_response: now,
        last_response: now,
      }],
    });

    const result = await getParticipantsWithStatusInternal('r-1');

    expect(result[0].status).toBe('Completed');
    expect(result[0].progress).toBe(100);
  });

  it('shows "In progress" when some modules answered', async () => {
    const now = new Date();
    setupQueries({
      participants: [{
        id: 'p5',
        name: 'Eve',
        answered_modules: 1,
        panel_status: null,
        first_response: now,
        last_response: now,
      }],
    });

    const result = await getParticipantsWithStatusInternal('r-1');

    expect(result[0].status).toBe('In progress');
    expect(result[0].progress).toBe(50); // 1/2 modules = 50%
  });

  it('shows "Not started" when no modules answered', async () => {
    setupQueries({
      participants: [{
        id: 'p6',
        name: 'Frank',
        answered_modules: 0,
        panel_status: null,
        first_response: null,
        last_response: null,
      }],
    });

    const result = await getParticipantsWithStatusInternal('r-1');

    expect(result[0].status).toBe('Not started');
    expect(result[0].progress).toBe(0);
  });

  it('caps progress at 99 when not fully completed', async () => {
    // 3 modules, 2 answered => 67%, not 100
    setupQueries({
      modules: [
        { id: 'm1', name: 'CSAT', config: JSON.stringify({ structure: { components: [] } }) },
        { id: 'm2', name: 'NPS', config: JSON.stringify({ structure: { components: [] } }) },
        { id: 'm3', name: 'CES', config: JSON.stringify({ structure: { components: [] } }) },
      ],
      participants: [{
        id: 'p7',
        name: 'Grace',
        answered_modules: 2,
        panel_status: null,
        first_response: new Date(),
        last_response: new Date(),
      }],
    });

    const result = await getParticipantsWithStatusInternal('r-1');

    expect(result[0].progress).toBeLessThanOrEqual(99);
    expect(result[0].status).toBe('In progress');
  });

  it('does not count a screener without question text', async () => {
    const screenerConfig = (question: string) => JSON.stringify({ structure: { components: [
      { id: 'screener-enabled', type: 'checkbox', value: 'false' },
      { id: 'screener-question', type: 'input', placeholder: { text: 'Ask something' }, value: question },
    ] } });
    const now = new Date();
    const participant = { id: 'p10', name: 'Judy', answered_modules: 1, panel_status: null, first_response: now, last_response: now };

    setupQueries({
      modules: [
        { id: 'm1', name: 'CSAT', config: JSON.stringify({ structure: { components: [] } }) },
        { id: 'm2', name: 'Screener', config: screenerConfig('') },
      ],
      participants: [participant],
    });
    const [unconfigured] = await getParticipantsWithStatusInternal('r-1');

    setupQueries({
      modules: [
        { id: 'm1', name: 'CSAT', config: JSON.stringify({ structure: { components: [] } }) },
        { id: 'm2', name: 'Screener', config: screenerConfig('Do you drink coffee?') },
      ],
      participants: [participant],
    });
    const [configured] = await getParticipantsWithStatusInternal('r-1');

    expect(unconfigured.progress).toBe(100);
    expect(configured.progress).toBe(50);
  });

  it('overquota takes precedence over completion status', async () => {
    // Even if all modules are answered, overquota status wins
    setupQueries({
      participants: [{
        id: 'p8',
        name: 'Heidi',
        answered_modules: 2,
        panel_status: 'overquota',
        first_response: new Date(),
        last_response: new Date(),
      }],
    });

    const result = await getParticipantsWithStatusInternal('r-1');

    expect(result[0].status).toBe('Over quota');
  });

  it('uses participant name and email from JOIN', async () => {
    setupQueries({
      participants: [{
        id: 'p9',
        name: 'Ivan Petrov',
        email: 'ivan@test.com',
        answered_modules: 0,
        panel_status: null,
        first_response: null,
        last_response: null,
      }],
    });

    const result = await getParticipantsWithStatusInternal('r-1');

    expect(result[0].name).toBe('Ivan Petrov');
    expect(result[0].email).toBe('ivan@test.com');
  });

  it('throws when research not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // research check fails

    await expect(getParticipantsWithStatusInternal('nonexistent'))
      .rejects.toThrow('Research not found');
  });
});
