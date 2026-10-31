import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Share2, Check, Send, Plus, X, ExternalLink } from 'lucide-react';
import { Drawer } from '../../../components/ui/Drawer';
import apiClient from '../../../services/api/client';
import { ParticipantsTable } from '../participants/ParticipantsTable';
import { useAuthStore } from '../../../stores/auth.store';
import { useMonitoringReceiver } from '../../../hooks/useMonitoringReceiver';
import { researchInProgressService, type ResearchStatus, type Participant, type ResearchConfiguration } from '../../../services/researchInProgress.service';
import { triggerCsvDownload } from '../../../utils/csvDownload';
import { useToast } from '../../../hooks/useToast';

interface ResearchInProgressContentProps {
    researchId?: string;
}

/**
 * Componente principal para el monitoreo de investigación en curso
 * Muestra métricas, participantes y permite generar nuevos participantes
 * @param researchId - ID de la investigación (opcional, se obtiene de params si no se proporciona)
 */
export function ResearchInProgressContent({ researchId: propResearchId }: ResearchInProgressContentProps = {} as ResearchInProgressContentProps) {
    const params = useParams<{ id: string }>();
    const researchId = propResearchId || params.id;
    const toast = useToast();
    const toastRef = useRef(toast);
    const token = useAuthStore(state => state.token);

    toastRef.current = toast;

    // SSE monitoring (kept for future use, data loaded via REST for now)
    useMonitoringReceiver(researchId || null, token || null);

    const [status, setStatus] = useState<ResearchStatus>({
        status: { value: '--', description: 'Loading...', icon: 'chart-line' },
        participants: { value: '--', description: 'Loading...', icon: 'users' },
        completionRate: { value: '--', description: 'Loading...', icon: 'check-circle' },
        averageTime: { value: '--', description: 'Loading...', icon: 'clock' }
    });
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [researchConfig, setResearchConfig] = useState<ResearchConfiguration | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [shareDrawerOpen, setShareDrawerOpen] = useState(false);
    const [emailList, setEmailList] = useState<string[]>([]);
    const [newEmail, setNewEmail] = useState('');
    const [sending, setSending] = useState(false);

    const progressUrl = `${window.location.origin}/research/progress/${researchId}`;

    const handleShare = () => {
        navigator.clipboard.writeText(progressUrl).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handleOpenProgressLink = useCallback(() => {
        window.open(progressUrl, '_blank', 'noopener,noreferrer');
    }, [progressUrl]);

    const handleAddEmail = () => {
        const email = newEmail.trim();
        if (!email.includes('@')) return;
        if (emailList.includes(email)) return;
        setEmailList(prev => [...prev, email]);
        setNewEmail('');
    };

    const handleRemoveEmail = (email: string) => {
        setEmailList(prev => prev.filter(e => e !== email));
    };

    const handleSendEmails = async () => {
        if (emailList.length === 0) return;
        setSending(true);
        try {
            const result = await apiClient.post<{ sent: number; failed: number }>(`/research/${researchId}/share-progress`, { emails: emailList, progressUrl });
            toastRef.current.success(`Sent to ${result.sent} recipient(s)`);
            if (result.failed > 0) toastRef.current.error(`${result.failed} failed`);
            setEmailList([]);
            setShareDrawerOpen(false);
        } catch {
            toastRef.current.error('Failed to send emails');
        } finally {
            setSending(false);
        }
    };

    const loadData = async (): Promise<void> => {
        if (!researchId) return;

        setIsLoading(true);
        setError(null);

        try {
            const [metricsResponse, participantsResponse, configResponse] = await Promise.all([
                researchInProgressService.getOverviewMetrics(researchId),
                researchInProgressService.getParticipantsWithStatus(researchId),
                researchInProgressService.getResearchConfiguration(researchId)
            ]);

            if ((metricsResponse?.success && metricsResponse?.data) || (metricsResponse?.status === 200 && metricsResponse?.data)) {
                const metricsData = metricsResponse.data as ResearchStatus;
                if (metricsData.status && metricsData.participants && metricsData.completionRate && metricsData.averageTime) {
                    setStatus(metricsData);
                }
            }

            if ((participantsResponse.success && participantsResponse.data) || (participantsResponse.status === 200 && participantsResponse.data)) {
                let participantsData: Participant[];

                if (Array.isArray(participantsResponse.data)) {
                    participantsData = participantsResponse.data;
                } else if (participantsResponse.data && typeof participantsResponse.data === 'object' && 'data' in participantsResponse.data && Array.isArray(participantsResponse.data.data)) {
                    participantsData = participantsResponse.data.data;
                } else {
                    participantsData = [];
                }

                setParticipants(participantsData);
            }

            if ((configResponse?.success && configResponse?.data) || (configResponse?.status === 200 && configResponse?.data)) {
                const config = configResponse.data;
                setResearchConfig({
                    allowMobileDevices: config.linkConfig?.allowMobileDevices ?? true,
                });
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to load research data';
            setError(errorMessage);
            toastRef.current.error(errorMessage);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [researchId]);

    const handleDownloadParticipants = useCallback(() => {
        if (participants.length === 0) return;
        const header = ['id', 'name', 'email', 'status', 'progress', 'duration', 'last_activity'];
        const rows = participants.map(p => [
            p.id,
            `"${(p.name || '').replace(/"/g, '""')}"`,
            p.email || '',
            p.status,
            String(p.progress),
            p.duration || '',
            p.lastActivity || '',
        ].join(','));
        const csv = [header.join(','), ...rows].join('\n');
        triggerCsvDownload(csv, `participants-${researchId}.csv`);
    }, [participants, researchId]);

    const handleParticipantDeleted = (participantId: string): void => {
        setParticipants(prev => prev.filter(p => p.id !== participantId));

        setStatus(prev => ({
            ...prev,
            participants: {
                value: (participants.length - 1).toString(),
                description: `${Math.max(0, participants.filter(p => p.status === 'in_progress').length - 1)} activos`,
                icon: 'users'
            }
        }));
    };

    if (error) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center">
                    <h2 className="text-xl font-semibold text-red-600 mb-2">Error</h2>
                    <p className="text-gray-600">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
                <div className="p-3 rounded-lg border border-gray-200 bg-white">
                    <p className="text-xs text-gray-500 mb-1">Status</p>
                    <p className="text-sm font-semibold text-gray-900">{status.status?.value || '--'}</p>
                    <p className="text-[11px] text-gray-400">{status.status?.description || 'Loading...'}</p>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 bg-white">
                    <p className="text-xs text-gray-500 mb-1">Módulos</p>
                    <p className="text-sm font-semibold text-gray-900">{status.totalModules ?? '--'}</p>
                    <p className="text-[11px] text-gray-400">configurados</p>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 bg-white">
                    <p className="text-xs text-gray-500 mb-1">Participants</p>
                    <p className="text-sm font-semibold text-gray-900">{status.participants?.value || '--'}</p>
                    <p className="text-[11px] text-gray-400">{status.participants?.description || 'Loading...'}</p>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 bg-white">
                    <p className="text-xs text-gray-500 mb-1">Completion rate</p>
                    <p className="text-sm font-semibold text-gray-900">{status.completionRate?.value || '--'}</p>
                    <p className="text-[11px] text-gray-400">{status.completionRate?.description || 'Loading...'}</p>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 bg-white">
                    <p className="text-xs text-gray-500 mb-1">Average time</p>
                    <p className="text-sm font-semibold text-gray-900">{status.averageTime?.value || '--'}</p>
                    <p className="text-[11px] text-gray-400">{status.averageTime?.description || 'Loading...'}</p>
                </div>
            </div>

            {participants.length > 0 && (
                <div className="flex justify-end gap-2 mb-3">
                    <button
                        onClick={() => setShareDrawerOpen(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        <Send className="h-4 w-4" />
                        Send Link
                    </button>
                    <button
                        onClick={handleOpenProgressLink}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        <ExternalLink className="h-4 w-4" />
                        Open link
                    </button>
                    <button
                        onClick={handleShare}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        {copied ? <Check className="h-4 w-4 text-green-600" /> : <Share2 className="h-4 w-4" />}
                        {copied ? 'Copied!' : 'Copy link'}
                    </button>
                    <button
                        onClick={handleDownloadParticipants}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        <Download className="h-4 w-4" />
                        Download CSV
                    </button>
                </div>
            )}

            {/* Share Drawer */}
            <Drawer
                isOpen={shareDrawerOpen}
                onClose={() => setShareDrawerOpen(false)}
                title="Share Progress Report"
                width="md"
            >
                <div className="space-y-6">
                    {/* Public link */}
                    <div>
                        <label className="text-sm font-medium text-gray-700 mb-1.5 block">Public link</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={progressUrl}
                                readOnly
                                className="flex-1 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-600"
                            />
                            <button
                                onClick={handleShare}
                                className="px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                            >
                                {copied ? 'Copied!' : 'Copy'}
                            </button>
                        </div>
                    </div>

                    {/* Email recipients */}
                    <div>
                        <label className="text-sm font-medium text-gray-700 mb-1.5 block">Send by email</label>
                        <div className="flex items-center gap-2 mb-3">
                            <input
                                type="email"
                                value={newEmail}
                                onChange={(e) => setNewEmail(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddEmail(); } }}
                                placeholder="email@example.com"
                                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            <button
                                onClick={handleAddEmail}
                                disabled={!newEmail.includes('@')}
                                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg disabled:opacity-30"
                            >
                                <Plus className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Email list */}
                        {emailList.length > 0 && (
                            <div className="space-y-2 mb-4">
                                {emailList.map(email => (
                                    <div key={email} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                                        <span className="text-sm text-gray-700">{email}</span>
                                        <button onClick={() => handleRemoveEmail(email)} className="text-gray-400 hover:text-red-500">
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <button
                            onClick={handleSendEmails}
                            disabled={emailList.length === 0 || sending}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                            <Send className="h-4 w-4" />
                            {sending ? 'Sending...' : `Send to ${emailList.length} recipient${emailList.length !== 1 ? 's' : ''}`}
                        </button>
                    </div>
                </div>
            </Drawer>

            <ParticipantsTable
                participants={participants}
                onViewDetails={() => { }}
                researchId={researchId || ''}
                onParticipantDeleted={handleParticipantDeleted}
                isLoading={isLoading}
                researchConfig={researchConfig}
            />
        </div>
    );
}
