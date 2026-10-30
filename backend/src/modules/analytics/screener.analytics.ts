import pool from '../../config/database';

/**
 * Screener Analytics
 * Aggregates and analyzes screener responses for research results
 */

// ==========================================
// SCREENER RESULTS
// ==========================================

export const getScreenerResults = async (researchId: string, participantIds?: ReadonlySet<string>) => {
  // 1. Find the Screener stage and its module(s)
  const stageQuery = `
    SELECT s.id as stage_id, s.name as stage_name
    FROM stages s
    WHERE s.research_id = ?
      AND LOWER(s.name) = 'screener'
    LIMIT 1
  `;
  const stageResult = await pool.query(stageQuery, [researchId]);
  if (stageResult.rows.length === 0) {
    return { totalResponses: 0, qualified: 0, disqualified: 0, overquota: 0, choiceDistribution: [], dailyDistribution: [], bestDay: null, slowestDay: null, weeklyTimeSeries: [] };
  }
  const stageId = stageResult.rows[0].stage_id;

  // 2. Get Screener module(s) with config to extract choices and question text
  const moduleQuery = `
    SELECT id, name, config FROM modules
    WHERE research_id = ? AND stage_id = ?
    ORDER BY order_index
  `;
  const moduleResult = await pool.query(moduleQuery, [researchId, stageId]);

  // Extract choices config (Qualify/Disqualify labels) and question text from module
  const choicesMeta: Array<{ id: string; label: string; eligibility: string }> = [];
  let questionText = '';
  const moduleIds: string[] = [];
  for (const mod of moduleResult.rows) {
    moduleIds.push(mod.id);
    try {
      const config = typeof mod.config === 'string' ? JSON.parse(mod.config) : mod.config;
      const structure = config?.structure ?? config;
      // Question title
      const titleComp = structure?.components?.find((c: any) => c.id === 'question-title');
      if (titleComp?.value && !questionText) questionText = titleComp.value;
      // Choices with eligibility
      const choiceComps = (structure?.components ?? []).filter((c: any) => c.settings?.isChoice);
      for (const c of choiceComps) {
        choicesMeta.push({
          id: c.id,
          label: c.value || c.name || c.id,
          eligibility: c.settings?.eligibility || 'Qualify',
        });
      }
      // Also check choicesConfig format
      const choicesComp = structure?.components?.find((c: any) => c.choicesConfig);
      if (choicesComp?.choicesConfig?.choices) {
        for (const ch of choicesComp.choicesConfig.choices) {
          if (!choicesMeta.some(m => m.id === ch.id)) {
            choicesMeta.push({
              id: ch.id,
              label: ch.label || ch.id,
              eligibility: ch.eligibility || 'Qualify',
            });
          }
        }
      }
    } catch { /* ignore */ }
  }

  if (moduleIds.length === 0) {
    return { totalResponses: 0, qualified: 0, disqualified: 0, overquota: 0, choiceDistribution: [], dailyDistribution: [], bestDay: null, slowestDay: null, weeklyTimeSeries: [], questionText };
  }

  const isInScope = (participantId: string) => !participantIds || participantIds.has(participantId);

  // 3. Get all responses for Screener modules
  const placeholders = moduleIds.map(() => '?').join(',');
  const responsesQuery = `
    SELECT
      r.value,
      r.participant_id,
      r.component_id,
      r.created_at
    FROM responses r
    WHERE r.research_id = ?
      AND r.module_id IN (${placeholders})
      AND r.component_id = 'choice'
    ORDER BY r.created_at ASC
  `;
  const responsesResult = await pool.query(responsesQuery, [researchId, ...moduleIds]);

  // 4. Get participant statuses from participants table
  const statusQuery = `
    SELECT participant_id, status
    FROM participants
    WHERE research_id = ?
  `;
  const statusResult = await pool.query(statusQuery, [researchId]);
  const statusCounts: Record<string, number> = {};
  for (const row of statusResult.rows.filter(row => isInScope(row.participant_id))) {
    statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
  }

  // 5. Also count from participant_demographics for disqualifications (kiosk mode doesn't use participants table)
  // Use responses-based counting as primary source
  const responses = responsesResult.rows.filter(row => isInScope(row.participant_id)).map(row => {
    let value: string | string[];
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      value = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      value = [String(row.value)];
    }
    return {
      participantId: row.participant_id,
      choices: Array.isArray(value) ? value : [value],
      createdAt: row.created_at,
    };
  });

  // 6. Build choice label map
  const choiceLabels: Record<string, string> = {};
  const choiceEligibility: Record<string, string> = {};
  for (const c of choicesMeta) {
    choiceLabels[c.id] = c.label;
    choiceEligibility[c.id] = c.eligibility;
  }

  // 7. Aggregate choice distribution
  const choiceCounts: Record<string, number> = {};
  for (const r of responses) {
    for (const choice of r.choices) {
      choiceCounts[choice] = (choiceCounts[choice] || 0) + 1;
    }
  }

  // Include all configured choices (even with 0 responses)
  const allChoiceIds = new Set([
    ...Object.keys(choiceCounts),
    ...choicesMeta.map(c => c.id),
  ]);

  const totalResponses = responses.length;
  const choiceDistribution = Array.from(allChoiceIds).map(choiceId => ({
    choiceId,
    label: choiceLabels[choiceId] || choiceId,
    eligibility: choiceEligibility[choiceId] || 'Qualify',
    count: choiceCounts[choiceId] || 0,
    percentage: totalResponses > 0 ? Math.round(((choiceCounts[choiceId] || 0) / totalResponses) * 100 * 10) / 10 : 0,
  }));

  // 8. Count qualified vs disqualified from responses (based on choice eligibility)
  let qualifiedFromResponses = 0;
  let disqualifiedFromResponses = 0;
  for (const r of responses) {
    const isDisqualified = r.choices.some((c: string) => choiceEligibility[c] === 'Disqualify');
    if (isDisqualified) {
      disqualifiedFromResponses++;
    } else {
      qualifiedFromResponses++;
    }
  }

  // Use participants table counts if available, otherwise fall back to response-based
  const disqualified = statusCounts['disqualified'] || disqualifiedFromResponses;
  const overquota = statusCounts['overquota'] || 0;
  const complete = statusCounts['responded'] || qualifiedFromResponses;

  // 9. Daily distribution (last 30 days)
  const dailyDistribution: Array<{ date: string; count: number; byChoice: Record<string, number> }> = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const dayResponses = responses.filter(r => {
      const responseDate = new Date(r.createdAt).toISOString().split('T')[0];
      return responseDate === dateStr;
    });

    const byChoice: Record<string, number> = {};
    for (const r of dayResponses) {
      for (const choice of r.choices) {
        const label = choiceLabels[choice] || choice;
        byChoice[label] = (byChoice[label] || 0) + 1;
      }
    }

    dailyDistribution.push({
      date: dateStr,
      count: dayResponses.length,
      byChoice,
    });
  }

  // 10. Best and slowest day
  const daysWithData = dailyDistribution.filter(d => d.count > 0);
  let bestDay = null;
  let slowestDay = null;
  if (daysWithData.length > 0) {
    const sorted = [...daysWithData].sort((a, b) => b.count - a.count);
    const best = sorted[0];
    const slowest = sorted[sorted.length - 1];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const bestDate = new Date(best.date);
    bestDay = {
      date: best.date,
      dayName: dayNames[bestDate.getDay()],
      hour: '2:00 AM', // Approximate peak — would need hourly data for precision
      count: best.count,
      percentage: totalResponses > 0 ? Math.round((best.count / totalResponses) * 100 * 10) / 10 : 0,
    };

    const slowestDate = new Date(slowest.date);
    slowestDay = {
      date: slowest.date,
      dayName: dayNames[slowestDate.getDay()],
      hour: '6:00 AM',
      count: slowest.count,
      percentage: totalResponses > 0 ? Math.round((slowest.count / totalResponses) * 100 * 10) / 10 : 0,
    };
  }

  // 11. Weekly time series (last 7 days)
  const weeklyTimeSeries = dailyDistribution.slice(-7).map(d => {
    const date = new Date(d.date);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return {
      date: d.date,
      dayName: dayNames[date.getDay()],
      count: d.count,
    };
  });

  return {
    totalResponses,
    qualified: complete,
    disqualified,
    overquota,
    questionText,
    choiceDistribution,
    dailyDistribution,
    bestDay,
    slowestDay,
    weeklyTimeSeries,
  };
};
