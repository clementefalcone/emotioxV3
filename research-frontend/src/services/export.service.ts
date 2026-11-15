import apiClient from './api/client';
import * as XLSX from 'xlsx';

type CsvRow = Record<string, unknown>;

interface CsvTable {
    readonly headers: string[];
    readonly rows: CsvRow[];
}

export interface ResultsSection {
    readonly stageType: string;
    readonly stageId: string;
    readonly label: string;
    readonly moduleIds: readonly string[];
}

const RAW_PAGE_SIZE = 10000;

interface RawResponse {
    participant_id: string;
    module_id: string | null;
    module_name: string | null;
    question_id: string | null;
    component_id: string | null;
    question_text: string | null;
    value: unknown;
    created_at: string;
}

async function fetchAllResponses(researchId: string): Promise<RawResponse[]> {
    const all: RawResponse[] = [];
    for (let offset = 0; ; offset += RAW_PAGE_SIZE) {
        const res = await apiClient.get<{ responses: RawResponse[] }>(`/responses/research/${researchId}?limit=${RAW_PAGE_SIZE}&offset=${offset}`);
        all.push(...res.responses);
        if (res.responses.length < RAW_PAGE_SIZE) return all;
    }
}

const parseStoredValue = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
};

export const formatCellValue = (value: unknown): string => {
    const parsed = parseStoredValue(value);
    if (parsed === null || parsed === undefined) return '';
    if (Array.isArray(parsed)) return parsed.map(formatCellValue).join('; ');
    if (typeof parsed === 'object') return JSON.stringify(parsed);
    return String(parsed);
};

async function fetchDemographics(researchId: string) {
    const res = await apiClient.get<{
        results: {
            participants: Array<{ participantId: string; demographics: Record<string, string> }>;
            demographicTypes: string[];
        };
    }>(`/analytics/research/${researchId}/demographics`);
    return res.results;
}

interface SmartVOCScore {
    participantId: string;
    value: number;
    date: string;
}

interface SmartVOCData {
    metrics: { csatScores: SmartVOCScore[]; cesScores: SmartVOCScore[]; npsScores: SmartVOCScore[]; cvScores: SmartVOCScore[] };
    vocResponses: Array<{ text: string; sentiment?: string; participantId: string }>;
    nevResponsesData: Array<{ emotions: string[]; participantId: string }>;
}

async function buildSmartVOCTable(researchId: string): Promise<CsvTable> {
    const { results } = await apiClient.get<{ results: SmartVOCData }>(`/analytics/research/${researchId}/smartvoc`);
    const byParticipant = new Map<string, CsvRow>();
    const rowOf = (participantId: string): CsvRow => {
        const row = byParticipant.get(participantId) ?? {};
        byParticipant.set(participantId, row);
        return row;
    };
    const scoreColumns = { nps: results.metrics.npsScores, csat: results.metrics.csatScores, ces: results.metrics.cesScores, cv: results.metrics.cvScores };
    for (const [column, scores] of Object.entries(scoreColumns)) {
        for (const score of scores) rowOf(score.participantId)[column] = score.value;
    }
    for (const voc of results.vocResponses) Object.assign(rowOf(voc.participantId), { voc: voc.text, vocSentiment: voc.sentiment ?? '' });
    for (const nev of results.nevResponsesData) rowOf(nev.participantId).nev = nev.emotions.join(', ');
    return {
        headers: ['nps', 'csat', 'ces', 'cv', 'voc', 'vocSentiment', 'nev'],
        rows: Array.from(byParticipant, ([participantId, row]) => ({ participantId, ...row })),
    };
}

interface EyeTrackingStimulus {
    moduleName: string;
    participants: Array<{
        participantId: string;
        deviceType: string;
        qualityGrade: string;
        calibrationRmsePx: number | null;
        faceDetectedPercent: number | null;
        totalFixations: number;
        totalDwellTime: number;
        aoiMetrics: Array<{ label: string; dwellTimePercent: number; fixationCount: number; avgTTFF: number; isNoticed: boolean }>;
    }>;
}

async function buildEyeTrackingTable(researchId: string, section: ResultsSection): Promise<CsvTable> {
    const { results } = await apiClient.get<{ results: { stimuli: EyeTrackingStimulus[] } }>(
        `/analytics/research/${researchId}/eye-tracking?stageId=${section.stageId}`,
    );
    const aoiHeaders = new Set<string>();
    const rows = results.stimuli.flatMap(stimulus => stimulus.participants.map(participant => {
        const row: CsvRow = {
            participantId: participant.participantId,
            stimulus: stimulus.moduleName,
            device: participant.deviceType,
            precision: participant.qualityGrade,
            calibrationRmsePx: participant.calibrationRmsePx ?? '',
            faceDetectedPercent: participant.faceDetectedPercent ?? '',
            totalFixations: participant.totalFixations,
            totalDwellTimeMs: participant.totalDwellTime,
        };
        for (const aoi of participant.aoiMetrics) {
            const columns = {
                [`${aoi.label} · tiempo de mirada %`]: aoi.dwellTimePercent,
                [`${aoi.label} · fijaciones`]: aoi.fixationCount,
                [`${aoi.label} · primera mirada ms`]: aoi.isNoticed ? aoi.avgTTFF : '',
                [`${aoi.label} · notada`]: aoi.isNoticed ? 'sí' : 'no',
            };
            Object.keys(columns).forEach(header => aoiHeaders.add(header));
            Object.assign(row, columns);
        }
        return row;
    }));
    return {
        headers: ['stimulus', 'device', 'precision', 'calibrationRmsePx', 'faceDetectedPercent', 'totalFixations', 'totalDwellTimeMs', ...aoiHeaders],
        rows,
    };
}

interface IATModule {
    moduleId: string;
    moduleName: string;
    testType: string;
    targets: Array<{ id: string; name: string }>;
    attributes: Array<{ id: string; label: string }>;
    participantData?: Array<{
        participantId: string;
        rtByCombination: Record<string, number>;
        quality: string;
        accuracy: number;
        segmentation: Record<string, string>;
        dScore?: number;
        dScoreEffect?: string;
    }>;
}

async function buildIATTable(researchId: string, section: ResultsSection): Promise<CsvTable> {
    const { results } = await apiClient.get<{ results: { modules: IATModule[] } }>(`/analytics/research/${researchId}/implicit-association`);
    const moduleIds = new Set(section.moduleIds);
    const extraHeaders = new Set<string>();
    const rows = results.modules.filter(module => moduleIds.has(module.moduleId)).flatMap(module => (module.participantData ?? []).map(participant => {
        const row: CsvRow = {
            participantId: participant.participantId,
            module: module.moduleName,
            testType: module.testType,
            quality: participant.quality,
            accuracy: `${Math.round(participant.accuracy * 100)}%`,
            dScore: participant.dScore ?? '',
            dScoreEffect: participant.dScoreEffect ?? '',
        };
        for (const [combination, rt] of Object.entries(participant.rtByCombination)) {
            const [criterionId, targetId] = combination.split('×');
            const attribute = module.attributes.find(a => a.id === criterionId);
            const target = module.targets.find(t => t.id === targetId);
            if (!attribute || !target) continue;
            const header = `RT ${attribute.label} × ${target.name} ms`;
            extraHeaders.add(header);
            row[header] = rt;
        }
        for (const [attributeId, targetId] of Object.entries(participant.segmentation)) {
            const attribute = module.attributes.find(a => a.id === attributeId);
            if (!attribute) continue;
            const header = `Seg ${attribute.label}`;
            extraHeaders.add(header);
            row[header] = module.targets.find(t => t.id === targetId)?.name ?? targetId;
        }
        return row;
    }));
    return { headers: ['module', 'testType', 'quality', 'accuracy', 'dScore', 'dScoreEffect', ...extraHeaders], rows };
}

async function buildResponsesTable(researchId: string, section: ResultsSection): Promise<CsvTable> {
    const moduleIds = new Set(section.moduleIds);
    const responses = (await fetchAllResponses(researchId)).filter(response => response.module_id !== null && moduleIds.has(response.module_id));
    const headerByModule = new Map<string, string>();
    for (const response of responses) {
        const moduleId = response.module_id as string;
        if (headerByModule.has(moduleId)) continue;
        const name = response.module_name ?? moduleId;
        const repeats = [...headerByModule.values()].filter(header => header === name || header.startsWith(`${name} #`)).length;
        headerByModule.set(moduleId, repeats === 0 ? name : `${name} #${repeats + 1}`);
    }
    const byParticipant = new Map<string, CsvRow>();
    for (const response of responses) {
        const row = byParticipant.get(response.participant_id) ?? { participantId: response.participant_id };
        row[headerByModule.get(response.module_id as string) as string] = formatCellValue(response.value);
        byParticipant.set(response.participant_id, row);
    }
    return { headers: [...headerByModule.values()], rows: [...byParticipant.values()] };
}

const SECTION_TABLE_BUILDERS: Record<string, (researchId: string, section: ResultsSection) => Promise<CsvTable>> = {
    'smart-voc': buildSmartVOCTable,
    'eye-tracking': buildEyeTrackingTable,
    'implicit-association': buildIATTable,
};

const toFileName = (researchName: string, suffix: string): string =>
    `${researchName}_${suffix}`.replace(/[^\p{L}\p{N}_-]+/gu, '_') + '.csv';

function downloadCsv(fileName: string, table: CsvTable): void {
    const sheet = XLSX.utils.json_to_sheet(table.rows, { header: table.headers });
    const blob = new Blob(['﻿' + XLSX.utils.sheet_to_csv(sheet)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}

export async function downloadRawData(researchId: string, researchName: string): Promise<void> {
    const responses = await fetchAllResponses(researchId);
    const rows = responses
        .map(response => ({
            participantId: response.participant_id,
            module: response.module_name ?? '',
            moduleId: response.module_id ?? '',
            questionId: response.question_id ?? '',
            componentId: response.component_id ?? '',
            question: response.question_text ?? '',
            value: formatCellValue(response.value),
            createdAt: response.created_at,
        }))
        .sort((a, b) => a.participantId.localeCompare(b.participantId) || a.createdAt.localeCompare(b.createdAt));
    downloadCsv(toFileName(researchName, 'RAW_DATA'), {
        headers: ['participantId', 'module', 'moduleId', 'questionId', 'componentId', 'question', 'value', 'createdAt'],
        rows,
    });
}

export async function downloadSectionCsv(
    researchId: string,
    researchName: string,
    { section, participantIds }: { section: ResultsSection; participantIds?: readonly string[] },
): Promise<void> {
    const buildTable = SECTION_TABLE_BUILDERS[section.stageType] ?? buildResponsesTable;
    const [table, demographics] = await Promise.all([buildTable(researchId, section), fetchDemographics(researchId)]);
    const shownIds = participantIds ? new Set(participantIds) : null;
    const demographicsById = new Map(demographics.participants.map(participant => [participant.participantId, participant.demographics]));
    const rows = table.rows
        .filter(row => !shownIds || shownIds.has(String(row.participantId)))
        .map(row => ({ ...Object.fromEntries(demographics.demographicTypes.map(type => [type, demographicsById.get(String(row.participantId))?.[type] ?? ''])), ...row }));
    downloadCsv(toFileName(researchName, section.label), {
        headers: ['participantId', ...demographics.demographicTypes, ...table.headers],
        rows,
    });
}
