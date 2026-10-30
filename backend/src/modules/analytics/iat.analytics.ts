import pool from '../../config/database';

/**
 * Implicit Association Test (IAT) Analytics
 * Aggregates and analyzes IAT responses including D-score computation
 */

// ==========================================
// IMPLICIT ASSOCIATION RESULTS
// ==========================================

interface IATTarget {
  id: string;
  name: string;
  imageUrl?: string;
}

interface IATAttribute {
  id: string;
  label: string;
  /** Target assigned to this criterion (Attribute Testing only) */
  targetId?: string;
}

/** Greenwald D-score effect size interpretation */
type DScoreEffect = 'none' | 'slight' | 'moderate' | 'strong';

interface DScoreResult {
  /** Greenwald D-score value */
  value: number;
  /** Effect interpretation */
  effect: DScoreEffect;
  /** Number of valid participants used */
  validParticipants: number;
  /** 95% CI lower bound */
  ciLower: number;
  /** 95% CI upper bound */
  ciUpper: number;
  /** Split-half reliability (Spearman-Brown corrected), null if < 10 trials */
  reliability: number | null;
}

interface IATParticipantData {
  participantId: string;
  /** Mean RT per (criterionId, targetId) combination */
  rtByCombination: Record<string, number>;
  /** Total trials in test phase */
  totalTrials: number;
  /** Trials with RT < 300ms (too fast) */
  fastTrials: number;
  /** Accuracy (correct / total) */
  accuracy: number;
  /** Quality flag: 'good' | 'fast_responses' | 'low_accuracy' | 'insufficient_data' */
  quality: 'good' | 'fast_responses' | 'low_accuracy' | 'insufficient_data';
  /** Segmentation: strongest associated target per criterion */
  segmentation: Record<string, string>;
  /** Individual Greenwald D-score (per target pair for Objects Comparing) */
  dScore?: number;
  dScoreEffect?: DScoreEffect;
}

interface RTDistributionStats {
  label: string;
  conditionId: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  stdDev: number;
  count: number;
}

interface IATCriterionScore {
  criterionId: string;
  criterionLabel: string;
  objectScores: Record<string, {
    netScore: number;
    dim1Pct: number;
    dim2Pct: number;
    meanRT: number;
    trials: number;
  }>;
}

interface IATModuleResult {
  moduleId: string;
  moduleName: string;
  testTitle?: string;
  testType: 'attribute_testing' | 'comparing_attribute' | 'objects_comparing';
  primingTime: number;
  targets: IATTarget[];
  attributes: IATAttribute[];
  totalResponses: number;
  scores: Array<{
    attributeId: string;
    attributeLabel: string;
    targetScores: Record<string, number>;
  }>;
  criteriaScores?: IATCriterionScore[];
  participantData?: IATParticipantData[];
  dScore?: DScoreResult;
  errorAnalysis?: {
    byPhase: Array<{ phase: string; total: number; errors: number; errorRate: number }>;
    byCombination: Array<{ targetId: string; targetName: string; attributeId: string; attributeLabel: string; total: number; errors: number; errorRate: number }>;
    overallErrorRate: number;
    overallFastRate: number;
  };
  rtDistribution?: RTDistributionStats[];
  responseQualities?: IATResponseQuality[];
}

type IATResponseQualityLevel = 'reliable' | 'same_choice' | 'too_fast';

interface IATResponseQuality {
  participantId: string;
  quality: IATResponseQualityLevel;
}

interface IATResultsScope {
  moduleId?: string;
  participantIds?: ReadonlySet<string>;
}

/**
 * Detect the IAT test type from the module template name
 */
const detectIATTestType = (moduleName: string): IATModuleResult['testType'] => {
  const lower = moduleName.toLowerCase();
  if (lower.includes('comparing attribute') || lower.includes('comparing attr')) return 'comparing_attribute';
  if (lower.includes('objects comparing') || lower.includes('object comparing')) return 'objects_comparing';
  return 'attribute_testing';
};

/**
 * Extract IAT configuration (targets, attributes, priming) from module config
 */
const extractIATConfig = (config: any, testType: IATModuleResult['testType']) => {
  const structure = config?.structure ?? config;
  const components: any[] = structure?.components ?? [];

  const primingComp = components.find((c: any) => c.id === 'priming-time');
  const primingTime = parseInt(primingComp?.value || '400', 10);

  const targets: IATTarget[] = [];
  const attributes: IATAttribute[] = [];
  const criteria: Array<{ id: string; label: string }> = [];

  if (testType === 'comparing_attribute') {
    for (let i = 1; i <= 20; i++) {
      const nameComp = components.find((c: any) => c.id === `object-${i}-name`);
      if (!nameComp) continue;
      if (nameComp.value) {
        const imageComp = components.find((c: any) => c.id === `object-${i}-image`);
        targets.push({
          id: `object-${i}`,
          name: nameComp.value,
          imageUrl: imageComp?.value || undefined,
        });
      }
    }
    const dim1 = components.find((c: any) => c.id === 'dimension-1');
    const dim2 = components.find((c: any) => c.id === 'dimension-2');
    if (dim1?.value || dim1?.placeholder?.text) {
      attributes.push({ id: 'dimension-1', label: dim1.value || dim1.placeholder.text });
    }
    if (dim2?.value || dim2?.placeholder?.text) {
      attributes.push({ id: 'dimension-2', label: dim2.value || dim2.placeholder.text });
    }
    const criteriaComp = components.find((c: any) => c.id === 'criteria');
    if (criteriaComp?.value) {
      const items = typeof criteriaComp.value === 'string'
        ? JSON.parse(criteriaComp.value)
        : criteriaComp.value;
      const list = Array.isArray(items) ? items : items?.items ?? [];
      for (const item of list) {
        if (item.hidden) continue;
        const label = (item.label || item.text || item.value || item.name || '').toString().trim();
        if (!label) continue;
        criteria.push({ id: item.id || String(list.indexOf(item)), label });
      }
    }
  } else {
    // Attribute Testing / Objects Comparing: target-N-name, target-N-image, criteria list
    for (let i = 1; i <= 20; i++) {
      const nameComp = components.find((c: any) => c.id === `target-${i}-name`);
      if (!nameComp) continue;
      if (nameComp.value) {
        const imageComp = components.find((c: any) => c.id === `target-${i}-image`);
        targets.push({
          id: `target-${i}`,
          name: nameComp.value,
          imageUrl: imageComp?.value || undefined,
        });
      }
    }
    // Criteria list from ranking-list component
    const criteriaComp = components.find((c: any) => c.id === 'criteria');
    if (criteriaComp?.value) {
      const items = typeof criteriaComp.value === 'string'
        ? JSON.parse(criteriaComp.value)
        : criteriaComp.value;
      const list = Array.isArray(items) ? items : items?.items ?? [];
      for (const item of list) {
        if (item.hidden) continue;
        const label = (item.label || item.text || item.value || item.name || '').toString().trim();
        if (!label) continue;
        attributes.push({
          id: item.id || item.value || String(list.indexOf(item)),
          label: label || `Attribute ${list.indexOf(item) + 1}`,
          targetId: item.targetId || undefined,
        });
      }
    }

    // Objects Comparing: criteria-1/criteria-2 are the two dimensions (e.g. Bueno/Malo).
    // The ranking list items are individual criteria, not chart dimensions.
    // Always override attributes with criteria-1/criteria-2 for Objects Comparing.
    if (testType === 'objects_comparing') {
      const c1 = components.find((c: any) => c.id === 'criteria-1');
      const c2 = components.find((c: any) => c.id === 'criteria-2');
      const l1 = (c1?.value ?? c1?.placeholder?.text ?? '').toString().trim();
      const l2 = (c2?.value ?? c2?.placeholder?.text ?? '').toString().trim();
      if (l1 && l2) {
        criteria.push(...attributes.map(({ id, label }) => ({ id, label })));
        attributes.length = 0;
        attributes.push({ id: 'criteria-1', label: l1 });
        attributes.push({ id: 'criteria-2', label: l2 });
      }
    }
  }

  return { primingTime, targets, attributes, criteria };
};

/**
 * Compute IAT scores from trial-level response data.
 * Each response has component_id='iat-trials' and value = JSON array of trials:
 * [{ targetId, criterionId, rt, correct, phase }]
 *
 * Score per (attribute, target) = association strength based on reaction times.
 * D-score approach: (mean_RT_incongruent - mean_RT_congruent) / pooled_SD,
 * then scaled to -100..100 range.
 *
 * When no data: returns 0 for all scores.
 */

function hasLegacy7BlockData(responses: any[]): boolean {
  for (const row of responses) {
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      const trials = Array.isArray(parsed) ? parsed : parsed?.trials ?? [];
      if (trials.some((t: any) => t.phase === 'block-3' || t.phase === 'block-6')) return true;
    } catch { /* skip */ }
  }
  return false;
}

const computeChoiceShares = (
  trials: Array<{ targetId: string; criterionId: string }>,
  targets: IATTarget[],
  attributes: IATAttribute[],
): IATModuleResult['scores'] => attributes.map(attr => ({
  attributeId: attr.id,
  attributeLabel: attr.label,
  targetScores: Object.fromEntries(targets.map(target => {
    const shown = trials.filter(t => t.targetId.split('__')[0] === target.id);
    const chosen = shown.filter(t => t.criterionId === attr.id).length;
    return [target.id, shown.length > 0 ? Math.round((chosen / shown.length) * 100) : 0];
  })),
}));

const computeIATScores = (
  responses: any[],
  targets: IATTarget[],
  attributes: IATAttribute[],
  testType: IATModuleResult['testType'],
): IATModuleResult['scores'] => {
  // Parse all trials from all responses
  type Trial = { targetId: string; criterionId: string; rt: number; correct: boolean; phase: string };
  const allTrials: Trial[] = [];

  for (const row of responses) {
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      const trials: Trial[] = Array.isArray(parsed) ? parsed : parsed?.trials ?? [];
      for (const t of trials) {
        if (t.rt <= 0) continue;
        if (!(t.phase?.startsWith('block') || t.phase === 'test')) continue;
        if (t.phase === 'block-1') continue;
        allTrials.push(t);
      }
    } catch { /* skip malformed */ }
  }

  // Group trials by (criterionId, targetId) → array of reaction times
  // Trial targetId may be compound: "object-1__criterion-UUID" → extract base "object-1"
  const rtMap: Record<string, Record<string, number[]>> = {};
  for (const t of allTrials) {
    const baseTargetId = t.targetId.includes('__') ? t.targetId.split('__')[0] : t.targetId;
    if (!rtMap[t.criterionId]) rtMap[t.criterionId] = {};
    if (!rtMap[t.criterionId][baseTargetId]) rtMap[t.criterionId][baseTargetId] = [];
    rtMap[t.criterionId][baseTargetId].push(t.rt);
  }

  // Compute overall mean RT and SD for normalization
  const allRTs = allTrials.map(t => t.rt);
  const overallMean = allRTs.length > 0 ? allRTs.reduce((a, b) => a + b, 0) / allRTs.length : 0;
  const overallSD = allRTs.length > 1
    ? Math.sqrt(allRTs.reduce((sum, rt) => sum + (rt - overallMean) ** 2, 0) / (allRTs.length - 1))
    : 1;

  if (testType === 'objects_comparing' && attributes.length === 2) {
    const hasLegacy = allTrials.some(t => t.phase === 'block-3' || t.phase === 'block-6');
    if (hasLegacy) {
      const congruentRTs: number[] = [];
      const incongruentRTs: number[] = [];
      for (const t of allTrials) {
        if (t.phase === 'block-3' || t.phase === 'block-4') congruentRTs.push(t.rt);
        else if (t.phase === 'block-6' || t.phase === 'block-7') incongruentRTs.push(t.rt);
      }
      const dim1Scores: Record<string, number> = {};
      const dim2Scores: Record<string, number> = {};
      if (congruentRTs.length > 0 && incongruentRTs.length > 0) {
        const meanCong = congruentRTs.reduce((a, b) => a + b, 0) / congruentRTs.length;
        const meanIncong = incongruentRTs.reduce((a, b) => a + b, 0) / incongruentRTs.length;
        const d = overallSD > 0 ? (meanIncong - meanCong) / overallSD : 0;
        for (const target of targets) {
          const score = Math.max(-100, Math.min(100, Math.round(d * 50)));
          dim1Scores[target.id] = Math.max(0, score);
          dim2Scores[target.id] = Math.max(0, -score);
        }
      } else {
        for (const target of targets) {
          dim1Scores[target.id] = 0;
          dim2Scores[target.id] = 0;
        }
      }
      return [
        { attributeId: attributes[0].id, attributeLabel: attributes[0].label, targetScores: dim1Scores },
        { attributeId: attributes[1].id, attributeLabel: attributes[1].label, targetScores: dim2Scores },
      ];
    }
    return computeChoiceShares(allTrials, targets, attributes);
  }

  return attributes.map(attr => {
    const targetScores: Record<string, number> = {};

    for (const target of targets) {
      // Attribute Testing: trial data has inverted semantics —
      // criterionId = target chosen, targetId = criterion shown (stimulus).
      // So rtMap is keyed as rtMap[target.id][attr.id] instead of rtMap[attr.id][target.id].
      const rts = testType === 'attribute_testing'
        ? (rtMap[target.id]?.[attr.id] ?? [])
        : (rtMap[attr.id]?.[target.id] ?? []);
      if (rts.length === 0 || overallSD === 0) {
        targetScores[target.id] = 0;
        continue;
      }
      const meanRT = rts.reduce((a, b) => a + b, 0) / rts.length;
      // D-score: how much faster/slower than overall mean, normalized by SD, scaled to -100..100
      // Negative score = faster than average (stronger association)
      const dScore = (overallMean - meanRT) / overallSD;
      // Clamp to -100..100
      targetScores[target.id] = Math.max(-100, Math.min(100, Math.round(dScore * 50)));
    }

    return {
      attributeId: attr.id,
      attributeLabel: attr.label,
      targetScores,
    };
  });
};

const computeCriteriaScores = (
  responses: any[],
  criteria: Array<{ id: string; label: string }>,
  attributes: IATAttribute[],
  targets: IATTarget[],
): IATCriterionScore[] => {
  if (criteria.length === 0 || attributes.length < 2 || targets.length === 0) return [];

  const dim1Id = attributes[0].id;

  type ParsedTrial = { objectId: string; criterionId: string; chosenDimension: string; rt: number };
  const allTrials: ParsedTrial[] = [];

  for (const row of responses) {
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      const trials = Array.isArray(parsed) ? parsed : parsed?.trials ?? [];
      for (const t of trials) {
        if (t.rt <= 0 || t.phase === 'practice' || t.phase === 'block-1') continue;
        const stimId: string = t.targetId ?? '';
        const parts = stimId.split('__');
        if (parts.length !== 2) continue;
        allTrials.push({
          objectId: parts[0],
          criterionId: parts[1],
          chosenDimension: t.criterionId ?? '',
          rt: t.rt,
        });
      }
    } catch { /* skip */ }
  }

  return criteria.map(crit => {
    const objectScores: IATCriterionScore['objectScores'] = {};

    for (const target of targets) {
      const trials = allTrials.filter(t => t.criterionId === crit.id && t.objectId === target.id);
      const total = trials.length;
      const dim1Count = trials.filter(t => t.chosenDimension === dim1Id).length;
      const dim2Count = total - dim1Count;
      const dim1Pct = total > 0 ? Math.round((dim1Count / total) * 100) : 0;
      const dim2Pct = total > 0 ? Math.round((dim2Count / total) * 100) : 0;
      const netScore = dim1Pct - dim2Pct;
      const rts = trials.map(t => t.rt);
      const meanRT = rts.length > 0 ? Math.round(rts.reduce((s, r) => s + r, 0) / rts.length) : 0;

      objectScores[target.id] = { netScore, dim1Pct, dim2Pct, meanRT, trials: total };
    }

    return {
      criterionId: crit.id,
      criterionLabel: crit.label,
      objectScores,
    };
  });
};

// ---------------------------------------------------------------------------
// Greenwald D-score algorithm (Greenwald, Nosek & Banaji, 2003)
// ---------------------------------------------------------------------------

function classifyDScoreEffect(d: number): DScoreEffect {
  const abs = Math.abs(d);
  if (abs < 0.15) return 'none';
  if (abs < 0.35) return 'slight';
  if (abs < 0.65) return 'moderate';
  return 'strong';
}

/**
 * Compute Greenwald improved D-score for one participant.
 * Compatible blocks = target1+positive / target2+negative (or equivalent).
 * Incompatible blocks = swapped.
 *
 * For Attribute Testing: compatible = target matched with assigned criterion,
 *   incompatible = target matched with non-assigned criterion.
 * For Objects Comparing: classic IAT 7-block design.
 *
 * @param compatibleRTs - reaction times from compatible block
 * @param incompatibleRTs - reaction times from incompatible block
 * @returns D-score or null if insufficient data
 */
function computeGreenwaldDScore(compatibleRTs: number[], incompatibleRTs: number[]): number | null {
  // Step 1: Remove trials > 10,000ms and < 300ms (Greenwald 2003 improved algorithm)
  const filteredCompat = compatibleRTs.filter(rt => rt >= 300 && rt <= 10000);
  const filteredIncompat = incompatibleRTs.filter(rt => rt >= 300 && rt <= 10000);

  if (filteredCompat.length < 2 || filteredIncompat.length < 2) return null;

  // Step 2: Compute means
  const meanCompat = filteredCompat.reduce((a, b) => a + b, 0) / filteredCompat.length;
  const meanIncompat = filteredIncompat.reduce((a, b) => a + b, 0) / filteredIncompat.length;

  // Step 3: Pooled SD across both blocks
  const allRTs = [...filteredCompat, ...filteredIncompat];
  const allMean = allRTs.reduce((a, b) => a + b, 0) / allRTs.length;
  const pooledSD = Math.sqrt(
    allRTs.reduce((sum, rt) => sum + (rt - allMean) ** 2, 0) / (allRTs.length - 1)
  );

  if (pooledSD === 0) return null;

  // Step 4: D = (mean_incompatible - mean_compatible) / pooled_SD
  return (meanIncompat - meanCompat) / pooledSD;
}

/**
 * Compute split-half reliability using odd/even trial split + Spearman-Brown correction.
 * Returns null if fewer than 10 D-scores (insufficient for reliability estimate).
 */
function computeSplitHalfReliability(individualDScores: number[]): number | null {
  const valid = individualDScores.filter(d => Number.isFinite(d));
  if (valid.length < 10) return null;

  // Split into odd/even halves
  const odd = valid.filter((_, i) => i % 2 === 0);
  const even = valid.filter((_, i) => i % 2 === 1);

  if (odd.length < 2 || even.length < 2) return null;

  // Pearson correlation between halves
  const n = Math.min(odd.length, even.length);
  const meanOdd = odd.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const meanEven = even.slice(0, n).reduce((a, b) => a + b, 0) / n;

  let sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = odd[i] - meanOdd;
    const dy = even[i] - meanEven;
    sumXY += dx * dy;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
  }

  const denom = Math.sqrt(sumX2 * sumY2);
  if (denom === 0) return null;

  const r = sumXY / denom;

  // Spearman-Brown correction: reliability = 2r / (1 + r)
  const reliability = (2 * r) / (1 + Math.abs(r));
  return Math.round(Math.max(0, Math.min(1, reliability)) * 1000) / 1000;
}

/**
 * Compute aggregate D-score with 95% CI from individual participant D-scores.
 */
function computeAggregateDScore(individualDScores: number[]): DScoreResult | undefined {
  const valid = individualDScores.filter(d => Number.isFinite(d));
  if (valid.length < 2) {
    if (valid.length === 1) {
      return {
        value: Math.round(valid[0] * 1000) / 1000,
        effect: classifyDScoreEffect(valid[0]),
        validParticipants: 1,
        ciLower: valid[0],
        ciUpper: valid[0],
        reliability: null,
      };
    }
    return undefined;
  }

  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const sd = Math.sqrt(valid.reduce((sum, d) => sum + (d - mean) ** 2, 0) / (valid.length - 1));
  const se = sd / Math.sqrt(valid.length);
  // t-distribution approximation for 95% CI (use 1.96 for large N, good enough)
  const tCrit = valid.length >= 30 ? 1.96 : 2.0;

  return {
    value: Math.round(mean * 1000) / 1000,
    effect: classifyDScoreEffect(mean),
    validParticipants: valid.length,
    ciLower: Math.round((mean - tCrit * se) * 1000) / 1000,
    ciUpper: Math.round((mean + tCrit * se) * 1000) / 1000,
    reliability: computeSplitHalfReliability(valid),
  };
}

/**
 * Readable phase labels for IAT blocks.
 */
const PHASE_LABELS: Record<string, string> = {
  'block-1': 'Practice',
  'block-2': 'Test',
  'block-3': 'Congruent Practice',
  'block-4': 'Congruent Test',
  'block-5': 'Target Reversed',
  'block-6': 'Incongruent Practice',
  'block-7': 'Incongruent Test',
  'test': 'Test',
  'practice': 'Practice',
};

/**
 * Compute error analysis from all IAT trial data.
 */
const computeIATErrorAnalysis = (
  responses: any[],
  targets: IATTarget[],
  attributes: IATAttribute[],
) => {
  type Trial = { targetId: string; criterionId: string; rt: number; correct: boolean; phase: string };
  const allTrials: Trial[] = [];

  for (const row of responses) {
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      const trials: Trial[] = Array.isArray(parsed) ? parsed : parsed?.trials ?? [];
      for (const t of trials) {
        if (!(t.phase === 'test' || t.phase?.startsWith('block'))) continue;
        if (t.phase === 'block-1') continue;
        allTrials.push(t);
      }
    } catch { /* skip */ }
  }

  if (allTrials.length === 0) return undefined;

  // Build name resolution maps — targets, attributes, AND criteria (criterion UUIDs)
  const nameMap = new Map<string, string>();
  for (const t of targets) nameMap.set(t.id, t.name);
  for (const a of attributes) nameMap.set(a.id, a.label);
  // combined-left/right → readable
  nameMap.set('combined-left', 'Combined Left');
  nameMap.set('combined-right', 'Combined Right');

  const resolveName = (id: string): string => nameMap.get(id) ?? id;

  // By phase — use readable labels, sorted by block order
  const phaseMap = new Map<string, { total: number; errors: number }>();
  for (const t of allTrials) {
    const p = t.phase || 'unknown';
    if (!phaseMap.has(p)) phaseMap.set(p, { total: 0, errors: 0 });
    const entry = phaseMap.get(p)!;
    entry.total++;
    if (t.correct === false) entry.errors++;
  }
  const byPhase = Array.from(phaseMap.entries())
    .map(([phase, data]) => ({
      phase: PHASE_LABELS[phase] ?? phase,
      total: data.total,
      errors: data.errors,
      errorRate: Math.round((data.errors / data.total) * 10000) / 100,
    }));

  // By combination — aggregate at target level (not criterion UUID level)
  // Group by (resolvedTarget × resolvedAttribute) to merge criterion UUIDs into their names
  const comboMap = new Map<string, { targetName: string; attributeLabel: string; total: number; errors: number }>();
  for (const t of allTrials) {
    const tName = resolveName(t.targetId.includes('__') ? t.targetId.split('__')[0] : t.targetId);
    const aName = resolveName(t.criterionId);
    const key = `${tName}×${aName}`;
    if (!comboMap.has(key)) comboMap.set(key, { targetName: tName, attributeLabel: aName, total: 0, errors: 0 });
    const entry = comboMap.get(key)!;
    entry.total++;
    if (t.correct === false) entry.errors++;
  }

  const byCombination = Array.from(comboMap.values())
    .filter(c => c.errors > 0) // only show combos with actual errors
    .map(c => ({
      targetId: '',
      targetName: c.targetName,
      attributeId: '',
      attributeLabel: c.attributeLabel,
      total: c.total,
      errors: c.errors,
      errorRate: Math.round((c.errors / c.total) * 10000) / 100,
    }))
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, 10); // top 10 only

  const totalErrors = allTrials.filter(t => t.correct === false).length;
  const totalFast = allTrials.filter(t => t.rt < 300).length;

  return {
    byPhase,
    byCombination,
    overallErrorRate: Math.round((totalErrors / allTrials.length) * 10000) / 100,
    overallFastRate: Math.round((totalFast / allTrials.length) * 10000) / 100,
  };
};

const FAST_RT_THRESHOLD = 300; // ms — trials below this are suspicious
const MIN_TRIALS_FOR_QUALITY = 5;
const MIN_ACCURACY_THRESHOLD = 0.6; // 60%
const MAX_FAST_RATIO = 0.3; // 30% fast trials = flagged

const SAME_CHOICE_RATIO = 0.95;

const isTestTrial = (t: { phase?: string }): boolean =>
  (t.phase === 'test' || !!t.phase?.startsWith('block')) && t.phase !== 'block-1';

const classifyResponseQuality = (trials: Array<{ criterionId: string; rt: number }>): IATResponseQualityLevel => {
  if (trials.filter(t => t.rt < FAST_RT_THRESHOLD).length / trials.length > MAX_FAST_RATIO) return 'too_fast';
  const choiceCounts = new Map<string, number>();
  for (const t of trials) choiceCounts.set(t.criterionId, (choiceCounts.get(t.criterionId) ?? 0) + 1);
  return Math.max(...choiceCounts.values()) / trials.length >= SAME_CHOICE_RATIO ? 'same_choice' : 'reliable';
};

const computeResponseQualities = (rows: Array<{ value: string | unknown; participant_id: string }>): IATResponseQuality[] =>
  rows.flatMap(row => {
    const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    const trials: Array<{ criterionId: string; rt: number; phase?: string }> = (Array.isArray(parsed) ? parsed : parsed?.trials ?? []).filter(isTestTrial);
    return trials.length > 0 ? [{ participantId: row.participant_id, quality: classifyResponseQuality(trials) }] : [];
  });

const computeIATParticipantData = (
  rows: Array<{ value: string | unknown; participant_id: string }>,
  targets: IATTarget[],
  attributes: IATAttribute[],
  testType?: IATModuleResult['testType'],
): IATParticipantData[] => {
  type Trial = { targetId: string; criterionId: string; rt: number; correct: boolean; phase: string };

  // Group trials by participant
  const byParticipant = new Map<string, Trial[]>();
  for (const row of rows) {
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      const trials: Trial[] = Array.isArray(parsed) ? parsed : parsed?.trials ?? [];
      const pid = row.participant_id;
      if (!byParticipant.has(pid)) byParticipant.set(pid, []);
      for (const t of trials) {
        if (!(t.phase === 'test' || t.phase?.startsWith('block'))) continue;
        if (t.phase === 'block-1') continue;
        byParticipant.get(pid)!.push(t);
      }
    } catch { /* skip */ }
  }

  const result: IATParticipantData[] = [];

  for (const [participantId, trials] of byParticipant) {
    const totalTrials = trials.length;
    const fastTrials = trials.filter(t => t.rt < FAST_RT_THRESHOLD).length;
    const correctTrials = trials.filter(t => t.correct !== false).length;
    const accuracy = totalTrials > 0 ? correctTrials / totalTrials : 0;

    // Quality flag
    let quality: IATParticipantData['quality'] = 'good';
    if (totalTrials < MIN_TRIALS_FOR_QUALITY) {
      quality = 'insufficient_data';
    } else if (fastTrials / totalTrials > MAX_FAST_RATIO) {
      quality = 'fast_responses';
    } else if (accuracy < MIN_ACCURACY_THRESHOLD) {
      quality = 'low_accuracy';
    }

    // Mean RT per (criterionId, targetId) — only correct test trials
    const rtByCombination: Record<string, number> = {};
    const rtAccum: Record<string, number[]> = {};
    for (const t of trials) {
      if (t.correct === false) continue;
      const key = `${t.criterionId}×${t.targetId}`;
      if (!rtAccum[key]) rtAccum[key] = [];
      rtAccum[key].push(t.rt);
    }
    for (const [key, rts] of Object.entries(rtAccum)) {
      rtByCombination[key] = Math.round(rts.reduce((a, b) => a + b, 0) / rts.length);
    }

    // Segmentation: for each criterion, which target has fastest mean RT
    const segmentation: Record<string, string> = {};
    for (const attr of attributes) {
      let bestTarget = '';
      let bestRT = Infinity;
      for (const target of targets) {
        const key = `${attr.id}×${target.id}`;
        const rt = rtByCombination[key];
        if (rt !== undefined && rt < bestRT) {
          bestRT = rt;
          bestTarget = target.id;
        }
      }
      if (bestTarget) segmentation[attr.id] = bestTarget;
    }

    const compatibleRTs: number[] = [];
    const incompatibleRTs: number[] = [];

    const isLegacyOC = testType === 'objects_comparing' && trials.some(t => t.phase === 'block-3' || t.phase === 'block-6');
    if (isLegacyOC) {
      for (const t of trials) {
        if (t.correct === false || t.rt > 10000) continue;
        if (t.phase === 'block-3' || t.phase === 'block-4') compatibleRTs.push(t.rt);
        else if (t.phase === 'block-6' || t.phase === 'block-7') incompatibleRTs.push(t.rt);
      }
    } else {
      for (const t of trials) {
        if (t.correct === false || t.rt > 10000) continue;
        const parts = t.targetId.includes('__') ? t.targetId.split('__') : null;
        if (!parts) continue;
        const [critId, tgtId] = parts;
        const attr = attributes.find(a => a.id === critId);
        if (!attr?.targetId) continue;
        const isAssigned = attr.targetId === tgtId
          || targets.some((tg, i) => tg.id === tgtId && (`Target ${i + 1}` === attr.targetId || `Object ${i + 1}` === attr.targetId));
        if (isAssigned) compatibleRTs.push(t.rt);
        else incompatibleRTs.push(t.rt);
      }
    }

    const dScore = computeGreenwaldDScore(compatibleRTs, incompatibleRTs);

    result.push({
      participantId,
      rtByCombination,
      totalTrials,
      fastTrials,
      accuracy: Math.round(accuracy * 100) / 100,
      quality,
      segmentation,
      dScore: dScore != null ? Math.round(dScore * 1000) / 1000 : undefined,
      dScoreEffect: dScore != null ? classifyDScoreEffect(dScore) : undefined,
    });
  }

  return result;
};

// ---------------------------------------------------------------------------
// RT Distribution (box plot statistics per condition)
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const computeRTDistribution = (
  responses: any[],
  targets: IATTarget[],
  _attributes: IATAttribute[],
  testType: IATModuleResult['testType'],
): RTDistributionStats[] => {
  type Trial = { targetId: string; criterionId: string; rt: number; correct: boolean; phase: string };
  const allTrials: Trial[] = [];

  for (const row of responses) {
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      const trials: Trial[] = Array.isArray(parsed) ? parsed : parsed?.trials ?? [];
      for (const t of trials) {
        if (t.rt > 0 && t.rt < 10000 && (t.phase?.startsWith('block') || t.phase === 'test') && t.phase !== 'block-1') {
          allTrials.push(t);
        }
      }
    } catch { /* skip */ }
  }

  if (allTrials.length === 0) return [];

  // Group by condition — by target/object
  const groups = new Map<string, { label: string; rts: number[] }>();

  for (const t of allTrials) {
    // Attribute Testing: criterionId = target chosen, targetId = criterion shown.
    // Group by the actual target (criterionId), not the stimulus.
    const groupKey = testType === 'attribute_testing'
      ? t.criterionId
      : (t.targetId.includes('__') ? t.targetId.split('__')[0] : t.targetId);
    if (!groups.has(groupKey)) {
      const target = targets.find(tg => tg.id === groupKey);
      groups.set(groupKey, { label: target?.name ?? groupKey, rts: [] });
    }
    groups.get(groupKey)!.rts.push(t.rt);
  }

  const stats: RTDistributionStats[] = [];
  for (const [conditionId, { label, rts }] of groups) {
    if (rts.length === 0) continue;
    const sorted = [...rts].sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const stdDev = sorted.length > 1
      ? Math.sqrt(sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (sorted.length - 1))
      : 0;

    const q1 = percentile(sorted, 25);
    const q3 = percentile(sorted, 75);
    const iqr = q3 - q1;
    const whiskerLow = sorted.find(v => v >= q1 - 1.5 * iqr) ?? sorted[0];
    const whiskerHigh = [...sorted].reverse().find(v => v <= q3 + 1.5 * iqr) ?? sorted[sorted.length - 1];

    stats.push({
      label,
      conditionId,
      min: whiskerLow,
      q1: Math.round(q1),
      median: Math.round(percentile(sorted, 50)),
      q3: Math.round(q3),
      max: whiskerHigh,
      mean: Math.round(mean),
      stdDev: Math.round(stdDev),
      count: sorted.length,
    });
  }

  return stats;
};

// ---------------------------------------------------------------------------
// Raw trial export
// ---------------------------------------------------------------------------

export const getIATRawTrials = async (researchId: string, moduleId?: string) => {
  // Reuse stage + module lookup from getImplicitAssociationResults
  const stageQuery = `
    SELECT s.id as stage_id
    FROM stages s
    WHERE s.research_id = ?
      AND LOWER(s.name) = 'implicit association'
  `;
  const stageResult = await pool.query(stageQuery, [researchId]);
  if (stageResult.rows.length === 0) return { trials: [] };
  const stageIds = stageResult.rows.map((r: Record<string, unknown>) => r.stage_id as string);

  const moduleQuery = `
    SELECT id, name, config FROM modules
    WHERE research_id = ? AND stage_id IN (${stageIds.map(() => '?').join(',')})
      AND (LOWER(name) LIKE '%attribute%' OR LOWER(name) LIKE '%objects comparing%' OR LOWER(name) LIKE '%object comparing%')
    ORDER BY order_index
  `;
  const moduleResult = await pool.query(moduleQuery, [researchId, ...stageIds]);
  const scopedModules = moduleId
    ? moduleResult.rows.filter((m: Record<string, unknown>) => m.id === moduleId)
    : moduleResult.rows;

  interface RawTrial {
    participantId: string;
    moduleId: string;
    module: string;
    trialNumber: number;
    testType: string;
    phase: string;
    targetId: string;
    targetName: string;
    criterionId: string;
    criterionLabel: string;
    attributeLabel: string;
    rt: number;
    correct: boolean;
  }

  const trials: RawTrial[] = [];

  for (const mod of scopedModules) {
    const testType = detectIATTestType(mod.name);
    let config: any = {};
    try { config = typeof mod.config === 'string' ? JSON.parse(mod.config) : mod.config; } catch { /* */ }
    const { targets, attributes, criteria } = extractIATConfig(config, testType);
    const criteriaMap = new Map(criteria.map(c => [c.id, c.label]));

    const targetMap = new Map(targets.map(t => [t.id, t.name]));
    const attrMap = new Map(attributes.map(a => [a.id, a.label]));

    const responsesQuery = `
      SELECT r.value, r.participant_id
      FROM responses r
      WHERE r.research_id = ? AND r.module_id = ? AND r.component_id = 'iat-trials'
    `;
    const responsesResult = await pool.query(responsesQuery, [researchId, mod.id]);

    for (const row of responsesResult.rows) {
      try {
        const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
        const trialList = Array.isArray(parsed) ? parsed : parsed?.trials ?? [];
        trialList.forEach((t: any, index: number) => {
          const [baseTargetId = '', attributeId = ''] = (t.targetId ?? '').split('__');
          trials.push({
            participantId: row.participant_id,
            moduleId: mod.id,
            module: mod.name,
            trialNumber: index + 1,
            testType,
            phase: t.phase ?? '',
            targetId: t.targetId ?? '',
            targetName: targetMap.get(baseTargetId) ?? baseTargetId,
            criterionId: t.criterionId ?? '',
            criterionLabel: attrMap.get(t.criterionId) ?? (t.criterionId ?? ''),
            attributeLabel: criteriaMap.get(attributeId) ?? '',
            rt: t.rt ?? 0,
            correct: t.correct !== false,
          });
        });
      } catch { /* skip */ }
    }
  }

  return { trials };
};

export const getImplicitAssociationResults = async (researchId: string, filterStageId?: string, scope: IATResultsScope = {}) => {
  let stageIds: string[];
  if (filterStageId) {
    stageIds = [filterStageId];
  } else {
    const stageQuery = `
      SELECT s.id as stage_id
      FROM stages s
      WHERE s.research_id = ?
        AND LOWER(s.name) = 'implicit association'
    `;
    const stageResult = await pool.query(stageQuery, [researchId]);
    if (stageResult.rows.length === 0) {
      return { modules: [] };
    }
    stageIds = stageResult.rows.map((r: Record<string, unknown>) => r.stage_id as string);
  }

  const moduleQuery = `
    SELECT id, name, config FROM modules
    WHERE research_id = ? AND stage_id IN (${stageIds.map(() => '?').join(',')})
      AND (LOWER(name) LIKE '%attribute%' OR LOWER(name) LIKE '%objects comparing%' OR LOWER(name) LIKE '%object comparing%')
    ORDER BY order_index
  `;
  const moduleResult = await pool.query(moduleQuery, [researchId, ...stageIds]);
  const scopedModules = scope.moduleId
    ? moduleResult.rows.filter((m: Record<string, unknown>) => m.id === scope.moduleId)
    : moduleResult.rows;

  const modules: IATModuleResult[] = [];

  for (const mod of scopedModules) {
    const testType = detectIATTestType(mod.name);
    let config: any = {};
    try {
      config = typeof mod.config === 'string' ? JSON.parse(mod.config) : mod.config;
    } catch { /* ignore */ }

    const { primingTime, targets, attributes, criteria } = extractIATConfig(config, testType);

    // Extract internal test title
    const structure = config?.structure ?? config;
    const testTitleComp = (structure?.components ?? []).find((c: any) => c.id === 'test-title');
    const testTitle = testTitleComp?.value?.toString().trim() || undefined;

    // 3. Get responses for this module (component_id = 'iat-trials')
    const responsesQuery = `
      SELECT r.value, r.participant_id, r.created_at
      FROM responses r
      WHERE r.research_id = ? AND r.module_id = ? AND r.component_id = 'iat-trials'
      ORDER BY r.created_at ASC
    `;
    const allResponses = await pool.query(responsesQuery, [researchId, mod.id]);
    const responsesResult = scope.participantIds
      ? { rows: allResponses.rows.filter((r: Record<string, unknown>) => scope.participantIds?.has(r.participant_id as string)) }
      : allResponses;

    const scores = computeIATScores(responsesResult.rows, targets, attributes, testType);

    // D-score and error analysis only apply to paradigms with correct/incorrect trials
    const isLegacyOC = testType === 'objects_comparing' && hasLegacy7BlockData(allResponses.rows);
    const hasDScore = testType === 'attribute_testing' || isLegacyOC;
    const participantData = hasDScore
      ? computeIATParticipantData(responsesResult.rows as Array<{ value: string | unknown; participant_id: string }>, targets, attributes, testType)
      : undefined;

    const dScore = hasDScore && participantData
      ? computeAggregateDScore(
          participantData.filter(p => p.quality === 'good' && p.dScore != null).map(p => p.dScore!)
        )
      : undefined;

    const errorAnalysis = hasDScore
      ? computeIATErrorAnalysis(responsesResult.rows, targets, attributes)
      : undefined;

    const rtDistribution = computeRTDistribution(responsesResult.rows, targets, attributes, testType);

    const criteriaScores = !isLegacyOC && criteria.length > 0
      ? computeCriteriaScores(responsesResult.rows, criteria, attributes, targets)
      : undefined;

    modules.push({
      moduleId: mod.id,
      moduleName: mod.name,
      testTitle,
      testType,
      primingTime,
      targets,
      attributes,
      totalResponses: responsesResult.rows.length,
      scores,
      criteriaScores,
      participantData,
      dScore,
      errorAnalysis,
      rtDistribution: rtDistribution.length > 0 ? rtDistribution : undefined,
      responseQualities: isLegacyOC ? undefined : computeResponseQualities(allResponses.rows as Array<{ value: string | unknown; participant_id: string }>),
    });
  }

  return { modules };
};
