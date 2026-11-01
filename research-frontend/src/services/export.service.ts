/**
 * Export Service
 *
 * Fetches all research data and generates a multi-sheet XLSX file:
 *   - Participants: one row per participant with demographics, responses, timing
 *   - SmartVOC: per-participant scores (NPS, CSAT, CES, CV) + VOC text
 *   - Eye Tracking: per-participant calibration quality, fixations, dwell time
 *   - IAT: per-participant RT, D-score, quality, segmentation
 */

import apiClient from './api/client';
import * as XLSX from 'xlsx';

/* ─── Types ─────────────────────────────────────────────────────── */

interface ExportParticipant {
    participantId: string;
    demographics: Record<string, string>;
    responses: Record<string, unknown>;
    startDate?: string;
    endDate?: string;
    duration?: number;
}

interface SmartVOCScore {
    participantId: string;
    value: number;
    date: string;
}

interface SmartVOCExportRow {
    participantId: string;
    nps?: number;
    csat?: number;
    ces?: number;
    cv?: number;
    voc?: string;
    vocSentiment?: string;
    nev?: string;
    date?: string;
}

interface ETParticipantRow {
    participantId: string;
    stimulus: string;
    calibrationQuality?: string;
    calibrationRmsePx?: number;
    integrityScore?: number;
    totalFixations?: number;
    totalDwellTime?: number;
    qualityGrade?: string;
}

interface IATParticipantRow {
    participantId: string;
    module: string;
    testType: string;
    quality?: string;
    accuracy?: string;
    dScore?: number;
    dScoreEffect?: string;
    [key: string]: unknown;
}

/* ─── Fetch helpers ─────────────────────────────────────────────── */

async function fetchDemographics(researchId: string) {
    const res = await apiClient.get<{
        results: {
            participants: Array<{ participantId: string; demographics: Record<string, string> }>;
            demographicTypes: string[];
        };
    }>(`/analytics/research/${researchId}/demographics`);
    return res.results;
}

async function fetchCognitiveTasks(researchId: string) {
    const res = await apiClient.get<{
        results: {
            modules: Array<{
                moduleId: string;
                moduleName: string;
                questionText: string;
                responses: Array<{ participantId: string; value: unknown; metadata?: Record<string, unknown>; createdAt: string }>;
            }>;
        };
    }>(`/analytics/research/${researchId}/cognitive-tasks`);
    return res.results?.modules || [];
}

async function fetchScreener(researchId: string) {
    const res = await apiClient.get<{
        results: { responses: Array<{ participantId: string; value: string }> };
    }>(`/analytics/research/${researchId}/screener`);
    return res.results?.responses || [];
}

interface IATModule {
    moduleId: string;
    moduleName: string;
    testType: string;
    targets: Array<{ id: string; name: string }>;
    attributes: Array<{ id: string; label: string; targetId?: string }>;
    participantData?: Array<{
        participantId: string;
        rtByCombination: Record<string, number>;
        quality: string;
        accuracy: number;
        segmentation: Record<string, string>;
        totalTrials: number;
        fastTrials: number;
        dScore?: number;
        dScoreEffect?: string;
    }>;
}

async function fetchIAT(researchId: string): Promise<IATModule[]> {
    const res = await apiClient.get<{ results: { modules: IATModule[] } }>(
        `/analytics/research/${researchId}/implicit-association`
    );
    return res.results?.modules || [];
}

interface SmartVOCData {
    csatScores: SmartVOCScore[];
    cesScores: SmartVOCScore[];
    npsScores: SmartVOCScore[];
    cvScores: SmartVOCScore[];
    vocResponses: Array<{ text: string; sentiment?: string; participantId: string; createdAt: string }>;
    nevResponsesData: Array<{ emotions: string[]; date: string; participantId: string }>;
}

async function fetchSmartVOC(researchId: string): Promise<SmartVOCData> {
    const res = await apiClient.get<{ results: SmartVOCData }>(
        `/analytics/research/${researchId}/smartvoc`
    );
    return res.results;
}

interface ETStimulus {
    moduleId: string;
    moduleName: string;
    participants: Array<{
        participantId: string;
        calibrationQuality?: string;
        calibrationRmsePx?: number;
        integrityScore?: number;
        totalFixations?: number;
        totalDwellTime?: number;
        qualityGrade?: string;
    }>;
}

async function fetchEyeTracking(researchId: string): Promise<ETStimulus[]> {
    const res = await apiClient.get<{ results: { stimuli: ETStimulus[] } }>(
        `/analytics/research/${researchId}/eye-tracking`
    );
    return res.results?.stimuli || [];
}

/* ─── IAT Raw Trials ───────────────────────────────────────────── */

interface IATRawTrial {
    participantId: string;
    module: string;
    testType: string;
    phase: string;
    targetId: string;
    targetName: string;
    trialNumber: number;
    criterionId: string;
    criterionLabel: string;
    attributeLabel: string;
    rt: number;
    correct: boolean;
}

async function fetchIATRawTrials(researchId: string): Promise<IATRawTrial[]> {
    const res = await apiClient.get<{ results: { trials: IATRawTrial[] } }>(
        `/analytics/research/${researchId}/implicit-association/raw-trials`
    );
    return res.results?.trials || [];
}

function buildIATRawTrialsSheet(trials: IATRawTrial[]) {
    const headers = ['participantId', 'module', 'testType', 'phase', 'trialNumber', 'targetId', 'targetName', 'criterionId', 'criterionLabel', 'attributeLabel', 'rt', 'correct'];
    const rows = trials.map(t => ({
        participantId: t.participantId,
        module: t.module,
        testType: t.testType,
        phase: t.phase,
        trialNumber: t.trialNumber,
        targetId: t.targetId,
        targetName: t.targetName,
        criterionId: t.criterionId,
        criterionLabel: t.criterionLabel,
        attributeLabel: t.attributeLabel,
        rt: t.rt,
        correct: t.correct ? 'TRUE' : 'FALSE',
    }));
    return { rows, headers };
}

/* ─── Sheet builders ────────────────────────────────────────────── */

function buildParticipantsSheet(
    demoData: Awaited<ReturnType<typeof fetchDemographics>>,
    cogModules: Awaited<ReturnType<typeof fetchCognitiveTasks>>,
    screenerChoices: Awaited<ReturnType<typeof fetchScreener>>,
    smartvoc: SmartVOCData | null,
) {
    const participantMap = new Map<string, ExportParticipant>();

    const getOrCreate = (pid: string): ExportParticipant => {
        if (!participantMap.has(pid)) {
            participantMap.set(pid, { participantId: pid, demographics: {}, responses: {} });
        }
        return participantMap.get(pid)!;
    };

    // Demographics
    for (const p of demoData.participants) {
        const ep = getOrCreate(p.participantId);
        ep.demographics = p.demographics;
    }

    // Cognitive task responses
    const responseColumns: string[] = [];
    for (const mod of cogModules) {
        const colName = mod.moduleName || mod.questionText || mod.moduleId;
        responseColumns.push(colName);
        for (const r of mod.responses) {
            const ep = getOrCreate(r.participantId);
            ep.responses[colName] = typeof r.value === 'object' ? JSON.stringify(r.value) : r.value;
            if (r.metadata?.duration && typeof r.metadata.duration === 'number') {
                ep.duration = (ep.duration || 0) + r.metadata.duration;
            }
            if (r.createdAt) {
                if (!ep.startDate || r.createdAt < ep.startDate) ep.startDate = r.createdAt;
                if (!ep.endDate || r.createdAt > ep.endDate) ep.endDate = r.createdAt;
            }
        }
    }

    // Screener
    if (screenerChoices.length > 0) {
        responseColumns.unshift('Screener');
        for (const r of screenerChoices) {
            getOrCreate(r.participantId).responses['Screener'] = r.value;
        }
    }

    // SmartVOC summary columns in participants sheet
    if (smartvoc) {
        const metricCols: string[] = [];
        if (smartvoc.npsScores.length) metricCols.push('NPS Score');
        if (smartvoc.csatScores.length) metricCols.push('CSAT Score');
        if (smartvoc.cesScores.length) metricCols.push('CES Score');
        if (smartvoc.cvScores.length) metricCols.push('CV Score');

        for (const col of metricCols) responseColumns.push(col);

        for (const s of smartvoc.npsScores) getOrCreate(s.participantId).responses['NPS Score'] = s.value;
        for (const s of smartvoc.csatScores) getOrCreate(s.participantId).responses['CSAT Score'] = s.value;
        for (const s of smartvoc.cesScores) getOrCreate(s.participantId).responses['CES Score'] = s.value;
        for (const s of smartvoc.cvScores) getOrCreate(s.participantId).responses['CV Score'] = s.value;
    }

    const demographicKeys = demoData.demographicTypes || [];
    const headers = ['participantId', ...demographicKeys, ...responseColumns, 'startDate', 'endDate', 'duration'];

    const rows = Array.from(participantMap.values()).map(p => {
        const row: Record<string, unknown> = { participantId: p.participantId };
        for (const dk of demographicKeys) row[dk] = p.demographics[dk] || '';
        for (const rc of responseColumns) {
            const val = p.responses[rc];
            row[rc] = val !== undefined && val !== null ? String(val) : '';
        }
        row['startDate'] = p.startDate || '';
        row['endDate'] = p.endDate || '';
        row['duration'] = p.duration ? formatDuration(p.duration) : '';
        return row;
    });

    return { rows, headers };
}

function buildSmartVOCSheet(smartvoc: SmartVOCData): SmartVOCExportRow[] {
    const participantMap = new Map<string, SmartVOCExportRow>();

    const getOrCreate = (pid: string): SmartVOCExportRow => {
        if (!participantMap.has(pid)) {
            participantMap.set(pid, { participantId: pid });
        }
        return participantMap.get(pid)!;
    };

    for (const s of smartvoc.npsScores) { const r = getOrCreate(s.participantId); r.nps = s.value; r.date = s.date; }
    for (const s of smartvoc.csatScores) { const r = getOrCreate(s.participantId); r.csat = s.value; if (!r.date) r.date = s.date; }
    for (const s of smartvoc.cesScores) { const r = getOrCreate(s.participantId); r.ces = s.value; if (!r.date) r.date = s.date; }
    for (const s of smartvoc.cvScores) { const r = getOrCreate(s.participantId); r.cv = s.value; if (!r.date) r.date = s.date; }

    for (const v of smartvoc.vocResponses) {
        const r = getOrCreate(v.participantId);
        r.voc = v.text;
        r.vocSentiment = v.sentiment || '';
    }

    for (const n of smartvoc.nevResponsesData) {
        const r = getOrCreate(n.participantId);
        r.nev = n.emotions.join(', ');
    }

    return Array.from(participantMap.values());
}

function buildEyeTrackingSheet(stimuli: ETStimulus[]): ETParticipantRow[] {
    const rows: ETParticipantRow[] = [];
    for (const stimulus of stimuli) {
        for (const p of stimulus.participants) {
            rows.push({
                participantId: p.participantId,
                stimulus: stimulus.moduleName,
                calibrationQuality: p.calibrationQuality,
                calibrationRmsePx: p.calibrationRmsePx,
                integrityScore: p.integrityScore,
                totalFixations: p.totalFixations,
                totalDwellTime: p.totalDwellTime,
                qualityGrade: p.qualityGrade,
            });
        }
    }
    return rows;
}

function buildIATSheet(iatModules: IATModule[]): IATParticipantRow[] {
    const rows: IATParticipantRow[] = [];

    for (const mod of iatModules) {
        if (!mod.participantData) continue;

        for (const pd of mod.participantData) {
            const row: IATParticipantRow = {
                participantId: pd.participantId,
                module: mod.moduleName,
                testType: mod.testType,
                quality: pd.quality,
                accuracy: `${Math.round(pd.accuracy * 100)}%`,
                dScore: pd.dScore,
                dScoreEffect: pd.dScoreEffect,
            };

            // RT per combination
            for (const [key, rt] of Object.entries(pd.rtByCombination)) {
                const [critId, targetId] = key.split('×');
                const attr = mod.attributes.find(a => a.id === critId);
                const target = mod.targets.find(t => t.id === targetId);
                if (attr && target) {
                    row[`RT ${attr.label} × ${target.name}`] = `${rt}ms`;
                }
            }

            // Segmentation
            for (const [attrId, targetId] of Object.entries(pd.segmentation)) {
                const attr = mod.attributes.find(a => a.id === attrId);
                if (attr) {
                    row[`Seg ${attr.label}`] = targetId;
                }
            }

            rows.push(row);
        }
    }

    return rows;
}

/* ─── Main export ───────────────────────────────────────────────── */

/**
 * Generates and downloads a multi-sheet XLSX file for a research.
 */
export async function downloadResearchExport(researchId: string, researchName: string, filteredParticipantIds?: string[]): Promise<void> {
    const pidSet = filteredParticipantIds ? new Set(filteredParticipantIds) : null;
    const filterRows = <T extends { participantId: string }>(rows: T[]): T[] =>
        pidSet ? rows.filter(r => pidSet.has(r.participantId)) : rows;

    // Fetch all data in parallel
    const [demoData, cogModules, screenerChoices, iatModules, smartvoc, etStimuli, iatRawTrials] = await Promise.all([
        fetchDemographics(researchId),
        fetchCognitiveTasks(researchId),
        fetchScreener(researchId),
        fetchIAT(researchId),
        fetchSmartVOC(researchId),
        fetchEyeTracking(researchId),
        fetchIATRawTrials(researchId),
    ]);

    const wb = XLSX.utils.book_new();

    // Apply completion filter to demographics
    const filteredDemoData = pidSet
        ? { ...demoData, participants: demoData.participants.filter(p => pidSet.has(p.participantId)) }
        : demoData;

    // Filter module responses
    const filteredCogModules = pidSet
        ? cogModules.map(m => ({ ...m, responses: m.responses.filter(r => pidSet.has(r.participantId)) }))
        : cogModules;
    const filteredScreener = pidSet
        ? screenerChoices.filter(r => pidSet.has(r.participantId))
        : screenerChoices;
    const filteredSmartVOC = pidSet && smartvoc
        ? {
            ...smartvoc,
            npsScores: smartvoc.npsScores.filter(s => pidSet.has(s.participantId)),
            csatScores: smartvoc.csatScores.filter(s => pidSet.has(s.participantId)),
            cesScores: smartvoc.cesScores.filter(s => pidSet.has(s.participantId)),
            cvScores: smartvoc.cvScores.filter(s => pidSet.has(s.participantId)),
            vocResponses: smartvoc.vocResponses.filter(v => pidSet.has(v.participantId)),
            nevResponsesData: smartvoc.nevResponsesData.filter(n => pidSet.has(n.participantId)),
        }
        : smartvoc;

    // Sheet 1: Participants (always present)
    const { rows: participantRows, headers } = buildParticipantsSheet(filteredDemoData, filteredCogModules, filteredScreener, filteredSmartVOC);
    const wsParticipants = XLSX.utils.json_to_sheet(participantRows, { header: headers });
    wsParticipants['!cols'] = headers.map(h => ({ wch: Math.max(h.length, 12) }));
    XLSX.utils.book_append_sheet(wb, wsParticipants, 'Participants');

    // Sheet 2: SmartVOC (if data exists)
    if (filteredSmartVOC && (filteredSmartVOC.npsScores.length || filteredSmartVOC.csatScores.length || filteredSmartVOC.vocResponses.length)) {
        const vocRows = buildSmartVOCSheet(filteredSmartVOC);
        const vocHeaders = ['participantId', 'nps', 'csat', 'ces', 'cv', 'voc', 'vocSentiment', 'nev', 'date'];
        const wsVOC = XLSX.utils.json_to_sheet(vocRows, { header: vocHeaders });
        wsVOC['!cols'] = vocHeaders.map(h => ({ wch: h === 'voc' ? 50 : Math.max(h.length, 12) }));
        XLSX.utils.book_append_sheet(wb, wsVOC, 'SmartVOC');
    }

    // Sheet 3: Eye Tracking (if data exists)
    if (etStimuli.length > 0) {
        let etRows = buildEyeTrackingSheet(etStimuli);
        if (pidSet) etRows = filterRows(etRows);
        if (etRows.length > 0) {
            const etHeaders = ['participantId', 'stimulus', 'calibrationQuality', 'calibrationRmsePx', 'integrityScore', 'totalFixations', 'totalDwellTime', 'qualityGrade'];
            const wsET = XLSX.utils.json_to_sheet(etRows, { header: etHeaders });
            wsET['!cols'] = etHeaders.map(h => ({ wch: Math.max(h.length, 14) }));
            XLSX.utils.book_append_sheet(wb, wsET, 'Eye Tracking');
        }
    }

    // Sheet 4: IAT (if data exists)
    if (iatModules.length > 0) {
        let iatRows = buildIATSheet(iatModules);
        if (pidSet) iatRows = filterRows(iatRows);
        if (iatRows.length > 0) {
            // Collect all unique keys for dynamic RT columns
            const allKeys = new Set<string>();
            for (const row of iatRows) {
                for (const key of Object.keys(row)) allKeys.add(key);
            }
            const iatHeaders = ['participantId', 'module', 'testType', 'quality', 'accuracy', 'dScore', 'dScoreEffect',
                ...Array.from(allKeys).filter(k => !['participantId', 'module', 'testType', 'quality', 'accuracy', 'dScore', 'dScoreEffect'].includes(k))
            ];
            const wsIAT = XLSX.utils.json_to_sheet(iatRows, { header: iatHeaders });
            wsIAT['!cols'] = iatHeaders.map(h => ({ wch: Math.max(h.length, 12) }));
            XLSX.utils.book_append_sheet(wb, wsIAT, 'Implicit Association');
        }
    }

    // Sheet 5: IAT Raw Trials (if data exists)
    if (iatRawTrials.length > 0) {
        const filteredTrials = pidSet ? iatRawTrials.filter(t => pidSet.has(t.participantId)) : iatRawTrials;
        if (filteredTrials.length > 0) {
            const { rows: trialRows, headers: trialHeaders } = buildIATRawTrialsSheet(filteredTrials);
            const wsTrials = XLSX.utils.json_to_sheet(trialRows, { header: trialHeaders });
            wsTrials['!cols'] = trialHeaders.map(h => ({ wch: Math.max(h.length, 14) }));
            XLSX.utils.book_append_sheet(wb, wsTrials, 'IAT Raw Trials');
        }
    }

    // Download as CSV (one sheet at a time — use first sheet with data)
    const sheetNames = wb.SheetNames;
    for (const name of sheetNames) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
        if (!csv.trim()) continue;
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${researchName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${name.replace(/\s+/g, '_')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }
}

function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
