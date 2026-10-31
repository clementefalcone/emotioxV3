import { useQuery } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { researchInProgressService, type ConsentRecord } from '../../services/researchInProgress.service';
import { buildCsv, triggerCsvDownload } from '../../utils/csvDownload';

const CONTEXT_LABELS: Record<ConsentRecord['context'], string> = {
    eye_tracking: 'Eye Tracking',
    emotion_analysis: 'Emotion Analysis',
    website_tracking: 'Website Tracking',
};

const DECISION_LABELS: Record<ConsentRecord['decision'], string> = {
    accepted: 'Aceptó',
    declined: 'Rechazó',
    withdrawn: 'Retiró',
};

const DECISION_STYLES: Record<ConsentRecord['decision'], string> = {
    accepted: 'bg-green-50 text-green-700',
    declined: 'bg-gray-100 text-gray-700',
    withdrawn: 'bg-amber-50 text-amber-700',
};

const CSV_COLUMNS: ReadonlyArray<keyof ConsentRecord> = ['created_at', 'subject_id', 'context', 'decision', 'locale', 'consent_text', 'consent_text_sha256'];
const VISIBLE_RECORDS = 10;

const countDecisions = (records: ReadonlyArray<ConsentRecord>) =>
    records.reduce<Record<ConsentRecord['decision'], number>>(
        (counts, record) => ({ ...counts, [record.decision]: counts[record.decision] + 1 }),
        { accepted: 0, declined: 0, withdrawn: 0 },
    );

export const ConsentRecordsSection = ({ researchId }: { researchId: string }) => {
    const { data: records, isLoading, error } = useQuery({
        queryKey: ['research', researchId, 'consent-records'],
        queryFn: () => researchInProgressService.getConsentRecords(researchId),
    });

    const downloadCsv = (allRecords: ReadonlyArray<ConsentRecord>) =>
        triggerCsvDownload(buildCsv(allRecords, CSV_COLUMNS), `consentimientos-${researchId}.csv`);

    return (
        <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-sm font-medium text-gray-900">Registro de consentimientos</h3>
                    <p className="text-xs text-gray-500">
                        Cada aceptación, rechazo o retiro queda guardado con el texto exacto que vio la persona.
                    </p>
                </div>
                {records && records.length > 0 && (
                    <Button variant="outline" size="sm" onClick={() => downloadCsv(records)}>
                        Descargar CSV
                    </Button>
                )}
            </div>

            {isLoading && <Skeleton className="h-20 w-full" />}
            {error && (
                <p className="text-xs text-red-600">
                    No se pudieron cargar los consentimientos: {error instanceof Error ? error.message : String(error)}
                </p>
            )}
            {records && records.length === 0 && <p className="text-xs text-gray-500">Aún no hay consentimientos registrados.</p>}
            {records && records.length > 0 && <ConsentRecordsSummary records={records} />}
        </div>
    );
};

const ConsentRecordsSummary = ({ records }: { records: ReadonlyArray<ConsentRecord> }) => {
    const counts = countDecisions(records);
    return (
        <>
            <div className="flex flex-wrap gap-2">
                {(Object.keys(DECISION_LABELS) as Array<ConsentRecord['decision']>).map(decision => (
                    <span key={decision} className={`px-2 py-0.5 text-xs font-medium rounded-full ${DECISION_STYLES[decision]}`}>
                        {DECISION_LABELS[decision]}: {counts[decision]}
                    </span>
                ))}
            </div>
            <ul className="divide-y divide-gray-200 text-xs">
                {records.slice(0, VISIBLE_RECORDS).map(record => (
                    <li key={record.id} className="flex items-center gap-3 py-1.5">
                        <span className="w-32 shrink-0 text-gray-500">{new Date(record.created_at).toLocaleString('es-CL')}</span>
                        <span className="flex-1 truncate text-gray-900" title={record.subject_id}>{record.subject_id}</span>
                        <span className="w-28 shrink-0 text-gray-500">{CONTEXT_LABELS[record.context]}</span>
                        <span className={`shrink-0 px-2 py-0.5 rounded-full ${DECISION_STYLES[record.decision]}`}>{DECISION_LABELS[record.decision]}</span>
                    </li>
                ))}
            </ul>
            {records.length > VISIBLE_RECORDS && (
                <p className="text-xs text-gray-500">
                    Se muestran los {VISIBLE_RECORDS} más recientes de {records.length}. El CSV incluye todos, con el texto aceptado.
                </p>
            )}
        </>
    );
};
