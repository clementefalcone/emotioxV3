import { useState } from 'react';
import { Download } from 'lucide-react';
import { downloadSectionCsv, type ResultsSection } from '../../../services/export.service';
import { useToast } from '../../../hooks/useToast';

interface SectionCsvButtonProps {
    readonly researchId: string;
    readonly researchName: string;
    readonly section: ResultsSection;
    readonly participantIds?: readonly string[];
}

export function SectionCsvButton({ researchId, researchName, section, participantIds }: SectionCsvButtonProps) {
    const [isDownloading, setIsDownloading] = useState(false);
    const toast = useToast();

    const download = async () => {
        setIsDownloading(true);
        try {
            await downloadSectionCsv(researchId, researchName, { section, participantIds });
        } catch (error) {
            toast.error(`No se pudo descargar el CSV de ${section.label}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <button
            type="button"
            onClick={download}
            disabled={isDownloading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
            <Download className="h-3.5 w-3.5" />
            {isDownloading ? 'Descargando…' : `CSV de ${section.label}`}
        </button>
    );
}
