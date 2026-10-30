import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import type { IATModuleResult, IATRawTrial } from '../../../../services/analytics.service';

const trial = (overrides: Partial<IATRawTrial>): IATRawTrial => ({
  participantId: 'p1', moduleId: 'module-1', trialNumber: 1, phase: 'block-2', targetName: 'Chicureo',
  attributeLabel: 'Navidad', criterionLabel: 'Positivo', rt: 800, correct: true, ...overrides,
});

vi.mock('../../../../services/analytics.service', () => ({
  getIATRawTrials: vi.fn(async () => [
    trial({ trialNumber: 1, phase: 'block-1', attributeLabel: '', correct: false }),
    trial({ trialNumber: 2 }),
    trial({ trialNumber: 3, targetName: 'Curacaví', criterionLabel: 'Negativo', rt: 200 }),
  ]),
  getDemographicResponses: vi.fn(async () => ({
    demographicTypes: ['age', 'gender'],
    participants: [{ participantId: 'p1', demographics: { age: '45-54', gender: 'Masculino' } }],
  })),
}));

vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof XLSX>();
  return { ...actual, writeFile: vi.fn() };
});

import { downloadIATRawData } from '../iatRawDataExport';

const module: IATModuleResult = {
  moduleId: 'module-1', moduleName: 'Objects Comparing', testType: 'objects_comparing', primingTime: 400,
  targets: [{ id: 'target-1', name: 'Chicureo' }, { id: 'target-2', name: 'Curacaví' }],
  attributes: [{ id: 'criteria-1', label: 'Positivo' }, { id: 'criteria-2', label: 'Negativo' }],
  totalResponses: 1, scores: [],
  responseQualities: [{ participantId: 'p1', quality: 'reliable' }],
};

describe('downloadIATRawData', () => {
  it('writes one row per trial and one per participant, with attribute, choice, quality and demographics', async () => {
    await downloadIATRawData('research-1', module, 'IAT 2');
    const [workbook, fileName] = vi.mocked(XLSX.writeFile).mock.calls[0];
    expect(fileName).toBe('IAT_2_raw_data.xlsx');
    const trials = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Trials);
    expect(trials).toHaveLength(3);
    expect(trials[0]).toMatchObject({ Fase: 'Práctica', Atributo: '', 'Correcta (solo práctica)': 'No' });
    expect(trials[2]).toMatchObject({
      IAT: 'IAT 2', Fase: 'Test', Objeto: 'Curacaví', Atributo: 'Navidad', Respuesta: 'Negativo',
      'Tiempo (ms)': 200, 'Menor a 300 ms': 'Sí', 'Calidad participante': 'Fiable', 'Age range': '45-54', Gender: 'Masculino',
    });
    const participants = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Participantes);
    expect(participants).toEqual([expect.objectContaining({
      Participante: 'p1', 'Ensayos test': 2, '% Positivo total': 50, '% Positivo Chicureo': 100, '% Positivo Curacaví': 0, '% respuestas < 300 ms': 50,
    })]);
  });
});
