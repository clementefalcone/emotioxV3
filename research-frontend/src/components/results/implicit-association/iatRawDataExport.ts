import * as XLSX from 'xlsx';
import {
  getDemographicResponses,
  getIATRawTrials,
  type IATModuleResult,
  type IATRawTrial,
  type IATResponseQualityLevel,
} from '../../../services/analytics.service';
import { getDemographicLabel } from '../shared/demographicLabels';

const QUALITY_NAMES: Record<IATResponseQualityLevel, string> = {
  reliable: 'Fiable',
  same_choice: 'Siempre la misma respuesta',
  too_fast: 'Demasiado rápidas',
};

const FAST_RT_MS = 300;

const isPracticeTrial = (trial: IATRawTrial): boolean => trial.phase === 'block-1' || trial.phase === 'practice';

const shareOf = (trials: readonly IATRawTrial[], choice: string): number | '' =>
  trials.length > 0 ? Math.round((trials.filter((t) => t.criterionLabel === choice).length / trials.length) * 1000) / 10 : '';

const buildLegend = (mod: IATModuleResult, moduleLabel: string): string[][] => [
  ['Hoja', 'Contenido'],
  ['Trials', 'Una fila por respuesta. Práctica: se clasifica el objeto, sin atributo. Test: el objeto aparece como prime y luego el atributo; el participante elige una de las dos categorías.'],
  ['Participantes', `Una fila por participante, con % ${mod.attributes[0]?.label ?? ''} total y por objeto (solo Test).`],
  ['Calidad: Demasiado rápidas', `Más del 30 % de las respuestas del Test en menos de ${FAST_RT_MS} ms.`],
  ['Calidad: Siempre la misma respuesta', '95 % o más de las respuestas del Test iguales.'],
  ['Calidad: Fiable', 'Ninguna de las anteriores. Mismo criterio que el filtro "Solo fiables".'],
  [moduleLabel, `Objetos: ${mod.targets.map((t) => t.name).join(', ')}`],
];

export async function downloadIATRawData(researchId: string, mod: IATModuleResult, moduleLabel: string): Promise<void> {
  const [trials, demographics] = await Promise.all([
    getIATRawTrials(researchId, mod.moduleId),
    getDemographicResponses(researchId),
  ]);
  const demographicsByParticipant = new Map(demographics.participants.map((p) => [p.participantId, p.demographics]));
  const qualityByParticipant = new Map((mod.responseQualities ?? []).map((q) => [q.participantId, QUALITY_NAMES[q.quality]]));
  const personOf = (participantId: string) => {
    const values = demographicsByParticipant.get(participantId) ?? {};
    return Object.fromEntries(demographics.demographicTypes.map((type) => [getDemographicLabel(type), values[type] ?? '']));
  };
  const positiveLabel = mod.attributes[0]?.label ?? '';

  const trialRows = trials.map((t) => ({
    Participante: t.participantId,
    IAT: moduleLabel,
    'N° ensayo': t.trialNumber,
    Fase: isPracticeTrial(t) ? 'Práctica' : 'Test',
    Objeto: t.targetName,
    Atributo: t.attributeLabel,
    Respuesta: t.criterionLabel,
    'Correcta (solo práctica)': isPracticeTrial(t) ? (t.correct ? 'Sí' : 'No') : '',
    'Tiempo (ms)': t.rt,
    [`Menor a ${FAST_RT_MS} ms`]: t.rt < FAST_RT_MS ? 'Sí' : 'No',
    'Calidad participante': qualityByParticipant.get(t.participantId) ?? '',
    ...personOf(t.participantId),
  }));

  const testTrialsByParticipant = new Map<string, IATRawTrial[]>();
  for (const t of trials) {
    if (isPracticeTrial(t)) continue;
    testTrialsByParticipant.set(t.participantId, [...(testTrialsByParticipant.get(t.participantId) ?? []), t]);
  }
  const participantRows = [...testTrialsByParticipant].map(([participantId, testTrials]) => ({
    Participante: participantId,
    IAT: moduleLabel,
    Calidad: qualityByParticipant.get(participantId) ?? '',
    'Ensayos test': testTrials.length,
    [`% respuestas < ${FAST_RT_MS} ms`]: Math.round((testTrials.filter((t) => t.rt < FAST_RT_MS).length / testTrials.length) * 1000) / 10,
    [`% ${positiveLabel} total`]: shareOf(testTrials, positiveLabel),
    ...Object.fromEntries(mod.targets.map((target) => [
      `% ${positiveLabel} ${target.name}`,
      shareOf(testTrials.filter((t) => t.targetName === target.name), positiveLabel),
    ])),
    ...personOf(participantId),
  }));

  const workbook = XLSX.utils.book_new();
  const appendSheet = (rows: Record<string, unknown>[], name: string) => {
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = Object.keys(rows[0] ?? {}).map((header) => ({ wch: Math.max(header.length + 2, 12) }));
    if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  };
  appendSheet(trialRows, 'Trials');
  appendSheet(participantRows, 'Participantes');
  const legend = XLSX.utils.aoa_to_sheet(buildLegend(mod, moduleLabel));
  legend['!cols'] = [{ wch: 36 }, { wch: 120 }];
  XLSX.utils.book_append_sheet(workbook, legend, 'Leyenda');
  XLSX.writeFile(workbook, `${moduleLabel.replace(/[^\p{L}\p{N}_-]+/gu, '_')}_raw_data.xlsx`);
}
