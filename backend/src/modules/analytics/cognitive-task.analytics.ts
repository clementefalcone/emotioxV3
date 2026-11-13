import pool from '../../config/database';

/**
 * Cognitive Task Analytics
 * Aggregates and analyzes participant responses for cognitive task modules
 */

// Module types that have their own dedicated analytics endpoint — the frontend
// fetches detailed responses from there, so /cognitive-tasks only needs the count.
const MODULES_WITH_OWN_ENDPOINT = new Set([
  'navigation flow', 'preference test', 'single choice', 'multiple choice',
  'linear scale', 'ranking',
]);

export const getCognitiveTaskResults = async (researchId: string) => {
  const modulesQuery = `
    SELECT m.id, m.name, m.description, m.config
    FROM modules m
    INNER JOIN stages s ON s.id = m.stage_id
    WHERE m.research_id = ?
      AND LOWER(s.name) LIKE '%cognitive task%'
    ORDER BY m.order_index
  `;
  const modulesResult = await pool.query(modulesQuery, [researchId]);
  const allModules = modulesResult.rows;

  // Split modules: those with dedicated endpoints only need counts,
  // text modules need full responses for inline rendering.
  const countOnlyIds: string[] = [];
  const fullFetchIds: string[] = [];
  for (const m of allModules) {
    if (MODULES_WITH_OWN_ENDPOINT.has((m.name as string).toLowerCase())) {
      countOnlyIds.push(m.id as string);
    } else {
      fullFetchIds.push(m.id as string);
    }
  }

  // Batch: 1 grouped COUNT for modules with own endpoints (replaces N individual queries)
  const countsMap = new Map<string, number>();
  if (countOnlyIds.length > 0) {
    const countQuery = `
      SELECT module_id, COUNT(*) as cnt
      FROM responses
      WHERE research_id = ? AND module_id IN (${countOnlyIds.map(() => '?').join(',')})
      GROUP BY module_id
    `;
    const countResult = await pool.query(countQuery, [researchId, ...countOnlyIds]);
    for (const row of countResult.rows) {
      countsMap.set(row.module_id as string, (row.cnt as number));
    }
  }

  // Fetch full responses only for text modules (parallel)
  const fullResponsesMap = new Map<string, Awaited<ReturnType<typeof getModuleResponses>>>();
  if (fullFetchIds.length > 0) {
    const results = await Promise.all(
      fullFetchIds.map(async (id) => ({ id, responses: await getModuleResponses(researchId, id) }))
    );
    for (const { id, responses } of results) {
      fullResponsesMap.set(id, responses);
    }
  }

  // Assemble response
  const modules = allModules.map((module) => {
    const moduleId = module.id as string;
    const hasOwnEndpoint = MODULES_WITH_OWN_ENDPOINT.has((module.name as string).toLowerCase());
    const responses = hasOwnEndpoint ? [] : (fullResponsesMap.get(moduleId) ?? []);
    const totalResponses = hasOwnEndpoint ? (countsMap.get(moduleId) ?? 0) : responses.length;

    // Extract question text from module config
    let questionText = '';
    try {
      const config = typeof module.config === 'string' ? JSON.parse(module.config) : module.config;
      const structure = config?.structure ?? config;
      const titleComponent = structure?.components?.find((c: { id: string }) => c.id === 'question-title');
      questionText = titleComponent?.value || '';
    } catch { /* ignore */ }

    return {
      moduleId,
      moduleName: module.name,
      description: module.description,
      questionText,
      totalResponses,
      responses,
    };
  });

  return { modules };
};

// ==========================================
// NAVIGATION FLOW RESULTS
// ==========================================

export const getNavigationFlowResults = async (researchId: string, moduleId: string) => {
  const query = `
    SELECT
      r.value,
      r.metadata,
      r.created_at,
      r.participant_id
    FROM responses r
    WHERE r.research_id = ?
      AND r.module_id = ?
      AND r.component_id = 'navigation-flow'
    ORDER BY r.created_at ASC
  `;

  const result = await pool.query(query, [researchId, moduleId]);

  const responses = result.rows.map(row => {
    try {
      const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      return {
        participantId: row.participant_id,
        ...value,
        metadata: row.metadata,
        createdAt: row.created_at,
      };
    } catch (error) {
      console.error('Error parsing navigation flow response:', error);
      return null;
    }
  }).filter(r => r !== null);

  // Aggregate statistics
  const totalResponses = responses.length;
  const completedFlows = responses.filter((r: any) => r.completed).length;
  const totalClicks = responses.reduce((sum: number, r: any) => sum + (r.totalClicks || 0), 0);
  const correctClicks = responses.reduce((sum: number, r: any) => sum + (r.correctClicks || 0), 0);
  const averageDuration = totalResponses > 0
    ? responses.reduce((sum: number, r: any) => sum + (r.totalDuration || 0), 0) / totalResponses
    : 0;

  // Heatmap data: aggregate all click coordinates with participantId (for AOI per-participant stats)
  const allClicks = responses.flatMap((r: any) =>
    (r.clickSequence || []).map((c: any) => ({ ...c, participantId: r.participantId }))
  );

  // Strip clickSequence from per-participant responses — frontend only needs summary stats
  // for the Navigation tab table. Click data lives in heatmapData (with participantId).
  const lightResponses = responses.map((r: any) => ({
    participantId: r.participantId,
    completed: r.completed,
    totalClicks: r.totalClicks || 0,
    correctClicks: r.correctClicks || 0,
    incorrectClicks: r.incorrectClicks || 0,
    totalDuration: r.totalDuration || 0,
    imagesNavigated: r.imagesNavigated,
    totalImages: r.totalImages,
    createdAt: r.createdAt,
  }));

  return {
    totalResponses,
    completedFlows,
    completionRate: totalResponses > 0 ? (completedFlows / totalResponses) * 100 : 0,
    totalClicks,
    correctClicks,
    accuracy: totalClicks > 0 ? (correctClicks / totalClicks) * 100 : 0,
    averageDuration: Math.round(averageDuration / 1000), // Convert to seconds
    heatmapData: allClicks,
    responses: lightResponses,
  };
};

// ==========================================
// PREFERENCE TEST RESULTS
// ==========================================

export const getPreferenceTestResults = async (researchId: string, moduleId: string) => {
  const query = `
    SELECT
      r.value,
      r.metadata,
      r.created_at,
      r.participant_id
    FROM responses r
    WHERE r.research_id = ?
      AND r.module_id = ?
      AND r.component_id = 'preference-test'
    ORDER BY r.created_at ASC
  `;

  const result = await pool.query(query, [researchId, moduleId]);

  const responses = result.rows.map(row => {
    try {
      const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      return {
        participantId: row.participant_id,
        ...value,
        metadata: row.metadata,
        createdAt: row.created_at,
      };
    } catch (error) {
      console.error('Error parsing preference test response:', error);
      return null;
    }
  }).filter(r => r !== null);

  // Aggregate selections
  const selectionCounts: Record<number, number> = {};
  responses.forEach((r: any) => {
    const imageId = r.selectedImageId;
    if (imageId) {
      selectionCounts[imageId] = (selectionCounts[imageId] || 0) + 1;
    }
  });

  // Calculate view statistics
  const totalViewTime = responses.reduce((sum: number, r: any) => {
    return sum + (r.viewHistory || []).reduce((s: number, v: any) => s + (v.duration || 0), 0);
  }, 0);

  const averageViewTime = responses.length > 0 ? totalViewTime / responses.length : 0;

  return {
    totalResponses: responses.length,
    selections: Object.entries(selectionCounts).map(([imageId, count]) => ({
      imageId: parseInt(imageId),
      count,
      percentage: responses.length > 0 ? (count / responses.length) * 100 : 0,
    })),
    averageViewTime: Math.round(averageViewTime),
    responses,
  };
};

// ==========================================
// TEXT RESPONSES
// ==========================================

export const getTextResponses = async (researchId: string, moduleId: string) => {
  const query = `
    SELECT
      r.value,
      r.metadata,
      r.created_at,
      r.participant_id
    FROM responses r
    WHERE r.research_id = ?
      AND r.module_id = ?
      AND r.component_id = 'answer'
    ORDER BY r.created_at DESC
  `;

  const result = await pool.query(query, [researchId, moduleId]);

  const { analyzeSentiment } = await import('../sentiment/sentiment.service');

  const responses = result.rows.map(row => {
    const text = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
    // Read sentiment from metadata or compute
    let sentiment: string | undefined;
    try {
      const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
      sentiment = meta?.sentiment;
    } catch { /* ignore */ }
    if (!sentiment && text.trim().length > 0) {
      sentiment = analyzeSentiment(text).sentiment;
    }
    return {
      participantId: row.participant_id,
      text,
      sentiment,
      metadata: row.metadata,
      createdAt: row.created_at,
    };
  });

  return {
    totalResponses: responses.length,
    responses,
  };
};

// ==========================================
// CHOICE RESPONSES (Single/Multiple)
// ==========================================

export const getChoiceResponses = async (researchId: string, moduleId: string) => {
  const [result, moduleResult] = await Promise.all([
    pool.query(`
      SELECT
        r.value,
        r.metadata,
        r.created_at,
        r.participant_id
      FROM responses r
      WHERE r.research_id = ?
        AND r.module_id = ?
        AND r.component_id = 'choice'
      ORDER BY r.created_at ASC
    `, [researchId, moduleId]),
    pool.query(`SELECT config FROM modules WHERE id = ?`, [moduleId]),
  ]);

  // Extract question text and configured choices from module structure
  let questionText = '';
  const configuredChoices: Array<{ id: string; label: string }> = [];
  if (moduleResult.rows.length > 0) {
    try {
      const config = typeof moduleResult.rows[0].config === 'string'
        ? JSON.parse(moduleResult.rows[0].config)
        : moduleResult.rows[0].config;
      const structure = config?.structure ?? config;
      const titleComponent = structure?.components?.find((c: { id: string }) => c.id === 'question-title');
      questionText = titleComponent?.value || '';
      // Extract choice options (components with settings.isChoice)
      const choiceComponents = (structure?.components ?? []).filter((c: any) => c.settings?.isChoice);
      choiceComponents.forEach((c: { id: string; value?: string; name?: string }) => {
        configuredChoices.push({ id: c.id, label: c.value || c.name || c.id });
      });
    } catch { /* ignore */ }
  }

  const responses = result.rows.map(row => {
    try {
      const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      return {
        participantId: row.participant_id,
        choices: Array.isArray(value) ? value : [value],
        metadata: row.metadata,
        createdAt: row.created_at,
      };
    } catch (error) {
      const value = row.value;
      return {
        participantId: row.participant_id,
        choices: Array.isArray(value) ? value : [value],
        metadata: row.metadata,
        createdAt: row.created_at,
      };
    }
  });

  // Aggregate choice counts
  const choiceCounts: Record<string, number> = {};
  responses.forEach((r: any) => {
    r.choices.forEach((choice: string) => {
      choiceCounts[choice] = (choiceCounts[choice] || 0) + 1;
    });
  });

  // Build choice labels map (id → label)
  const choiceLabels: Record<string, string> = {};
  configuredChoices.forEach(c => { choiceLabels[c.id] = c.label; });

  // Build choiceCounts including configured choices with 0 responses
  const allChoiceIds = new Set([
    ...Object.keys(choiceCounts),
    ...configuredChoices.map(c => c.id),
  ]);

  return {
    totalResponses: responses.length,
    questionText,
    choiceCounts: Array.from(allChoiceIds).map(choiceId => ({
      choice: choiceLabels[choiceId] || choiceId,
      rawKey: choiceId,
      count: choiceCounts[choiceId] || 0,
      percentage: responses.length > 0 ? ((choiceCounts[choiceId] || 0) / responses.length) * 100 : 0,
    })),
    responses,
  };
};

// ==========================================
// DEMOGRAPHIC RESPONSES (for Cognitive Tasks filters / export)
// ==========================================

export const getDemographicResponses = async (researchId: string) => {
  const query = `
    SELECT participant_id, demographic_type, demographic_value
    FROM participant_demographics
    WHERE research_id = ?
    ORDER BY participant_id, demographic_type
  `;
  const result = await pool.query(query, [researchId]);
  const rows = (result.rows || []) as Array<{ participant_id: string; demographic_type: string; demographic_value: string }>;

  const byParticipant = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const pid = row.participant_id;
    if (!byParticipant.has(pid)) byParticipant.set(pid, {});
    byParticipant.get(pid)![row.demographic_type] = row.demographic_value;
  }

  const participants = Array.from(byParticipant.entries()).map(([participantId, demographics]) => ({
    participantId,
    demographics,
  }));

  const demographicTypes = Array.from(
    new Set(rows.map((r) => r.demographic_type))
  ).sort();

  return {
    participants,
    demographicTypes,
  };
};

// ==========================================
// SCALE RESPONSES (Linear Scale)
// ==========================================

export const getScaleResponses = async (researchId: string, moduleId: string) => {
  // Fetch responses and module config in parallel
  const [result, moduleResult] = await Promise.all([
    pool.query(`
      SELECT
        r.value,
        r.metadata,
        r.created_at,
        r.participant_id
      FROM responses r
      INNER JOIN (
        SELECT participant_id, MAX(created_at) as max_created
        FROM responses
        WHERE research_id = ? AND module_id = ? AND component_id = 'scale'
        GROUP BY participant_id
      ) latest ON r.participant_id = latest.participant_id AND r.created_at = latest.max_created
      WHERE r.research_id = ?
        AND r.module_id = ?
        AND r.component_id = 'scale'
      ORDER BY r.created_at ASC
    `, [researchId, moduleId, researchId, moduleId]),
    pool.query(`SELECT config FROM modules WHERE id = ?`, [moduleId]),
  ]);

  // Extract question text and scale range from module structure
  let questionText = '';
  let scaleStart = 1;
  let scaleEnd = 5;
  if (moduleResult.rows.length > 0) {
    try {
      const config = typeof moduleResult.rows[0].config === 'string'
        ? JSON.parse(moduleResult.rows[0].config)
        : moduleResult.rows[0].config;
      const structure = config?.structure ?? config;
      const titleComponent = structure?.components?.find((c: { id: string }) => c.id === 'question-title');
      questionText = titleComponent?.value || '';
      // New format: single scale-range component (e.g. "1-5", "0-10")
      const rangeComponent = structure?.components?.find((c: { id: string }) => c.id === 'scale-range');
      if (rangeComponent?.value && String(rangeComponent.value).includes('-')) {
        const [rangeMin, rangeMax] = String(rangeComponent.value).split('-').map(Number);
        if (!isNaN(rangeMin)) scaleStart = rangeMin;
        if (!isNaN(rangeMax)) scaleEnd = rangeMax;
      } else if (rangeComponent?.defaultValue && String(rangeComponent.defaultValue).includes('-')) {
        const [rangeMin, rangeMax] = String(rangeComponent.defaultValue).split('-').map(Number);
        if (!isNaN(rangeMin)) scaleStart = rangeMin;
        if (!isNaN(rangeMax)) scaleEnd = rangeMax;
      } else {
        // Legacy: separate start-value / end-value components
        const startComponent = structure?.components?.find((c: { id: string }) => c.id === 'scale-start-value');
        const endComponent = structure?.components?.find((c: { id: string }) => c.id === 'scale-end-value');
        if (startComponent?.value) scaleStart = parseInt(startComponent.value) || 1;
        if (endComponent?.value) scaleEnd = parseInt(endComponent.value) || 5;
      }
    } catch { /* ignore parse errors */ }
  }

  const responses = result.rows.map(row => ({
    participantId: row.participant_id,
    value: typeof row.value === 'number' ? row.value : parseInt(row.value as string),
    metadata: row.metadata,
    createdAt: row.created_at,
  }));

  // Aggregate scale distribution (include all values in configured range)
  const distribution: Record<number, number> = {};
  for (let i = scaleStart; i <= scaleEnd; i++) {
    distribution[i] = 0;
  }
  responses.forEach((r: any) => {
    const value = r.value;
    distribution[value] = (distribution[value] || 0) + 1;
  });

  const average = responses.length > 0
    ? responses.reduce((sum: number, r: any) => sum + r.value, 0) / responses.length
    : 0;

  return {
    totalResponses: responses.length,
    average: Math.round(average * 100) / 100,
    questionText,
    distribution: Object.entries(distribution).map(([value, count]) => ({
      value: parseInt(value),
      count,
      percentage: responses.length > 0 ? (count / responses.length) * 100 : 0,
    })),
    responses,
  };
};

// ==========================================
// RANKING RESPONSES
// ==========================================

export const getRankingResponses = async (researchId: string, moduleId: string) => {
  // Fetch responses and module structure in parallel
  const [result, moduleResult] = await Promise.all([
    pool.query(`
      SELECT r.value, r.metadata, r.created_at, r.participant_id
      FROM responses r
      WHERE r.research_id = ? AND r.module_id = ? AND r.component_id = 'ranking'
      ORDER BY r.created_at ASC
    `, [researchId, moduleId]),
    pool.query(`SELECT config FROM modules WHERE id = ?`, [moduleId]),
  ]);

  // Build id→label map from module structure (structure is nested inside config)
  const itemLabels: Record<string, string> = {};
  let questionText = '';
  if (moduleResult.rows.length > 0) {
    try {
      const config = typeof moduleResult.rows[0].config === 'string'
        ? JSON.parse(moduleResult.rows[0].config)
        : moduleResult.rows[0].config;
      const structure = config?.structure ?? config;
      const titleComponent = structure?.components?.find((c: { id: string }) => c.id === 'question-title');
      questionText = titleComponent?.value || '';
      const rankingComponent = structure?.components?.find((c: any) => c.type === 'ranking-list' || c.rankingConfig);
      // Items can be in rankingConfig.items or in value (as JSON string with {items, randomize})
      let items = rankingComponent?.rankingConfig?.items ?? [];
      if (items.length === 0 && rankingComponent?.value) {
        const parsed = typeof rankingComponent.value === 'string'
          ? JSON.parse(rankingComponent.value)
          : rankingComponent.value;
        items = parsed?.items ?? [];
      }
      items.forEach((item: { id: string; label: string }) => {
        itemLabels[item.id] = item.label;
      });
    } catch { /* structure parse error — labels will fallback to IDs */ }
  }

  const responses = result.rows.map(row => {
    try {
      const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      return {
        participantId: row.participant_id,
        ranking: Array.isArray(value) ? value : [],
        metadata: row.metadata,
        createdAt: row.created_at,
      };
    } catch (error) {
      return null;
    }
  }).filter(r => r !== null);

  // Calculate mean position for each option
  const positionSums: Record<string, { sum: number; count: number }> = {};

  responses.forEach((r: any) => {
    r.ranking.forEach((item: string, index: number) => {
      if (!positionSums[item]) {
        positionSums[item] = { sum: 0, count: 0 };
      }
      positionSums[item].sum += index + 1; // Position starts at 1
      positionSums[item].count += 1;
    });
  });

  // Build rankings from responses, then add any configured items with 0 responses
  const rankingsFromResponses = Object.entries(positionSums).map(([item, data]) => ({
    item,
    label: itemLabels[item] || item,
    meanPosition: data.count > 0 ? data.sum / data.count : 0,
    count: data.count,
  }));

  // Add configured items that have no responses yet
  const respondedItems = new Set(rankingsFromResponses.map(r => r.item));
  const configuredItems = Object.entries(itemLabels)
    .filter(([id]) => !respondedItems.has(id))
    .map(([id, label]) => ({ item: id, label, meanPosition: 0, count: 0 }));

  const rankings = [...rankingsFromResponses, ...configuredItems]
    .sort((a, b) => a.meanPosition - b.meanPosition);

  return {
    totalResponses: responses.length,
    questionText,
    rankings,
    responses,
  };
};

// ==========================================
// HELPER FUNCTIONS
// ==========================================

const getModuleResponses = async (researchId: string, moduleId: string) => {
  const query = `
    SELECT
      r.component_id,
      r.value,
      r.metadata,
      r.created_at,
      r.participant_id
    FROM responses r
    WHERE r.research_id = ? AND r.module_id = ?
    ORDER BY r.created_at ASC
  `;

  const result = await pool.query(query, [researchId, moduleId]);
  const { analyzeSentiment } = await import('../sentiment/sentiment.service');

  return result.rows.map(row => {
    const meta = typeof row.metadata === 'string' ? (() => { try { return JSON.parse(row.metadata); } catch { return {}; } })() : (row.metadata ?? {});
    // Compute sentiment on-the-fly for text responses without stored sentiment
    if ((row.component_id === 'answer' || row.component_id === 'text') && !meta.sentiment) {
      const text = typeof row.value === 'string' ? row.value : '';
      if (text.trim().length > 0) {
        meta.sentiment = analyzeSentiment(text).sentiment;
      }
    }
    return {
      componentId: row.component_id,
      value: row.value,
      metadata: meta,
      createdAt: row.created_at,
      participantId: row.participant_id,
    };
  });
};
