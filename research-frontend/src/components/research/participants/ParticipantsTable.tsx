import { useState, useMemo, useRef, useEffect } from 'react';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/Card';
import { Drawer } from '../../ui/Drawer';
import { DrawerDetailsSkeleton } from '../../ui/Skeleton';
import { researchInProgressService, type Participant, type ParticipantDetails, type ResearchConfiguration } from '../../../services/researchInProgress.service';
import {
    AlertCircle,
    AlertTriangle,
    CheckCircle,
    Clock,
    Eye,
    Trash2,
    Users
} from 'lucide-react';
import { useToast } from '../../../hooks/useToast';
import { getReviewUrl } from '../../../utils/publicTestsUrl';

interface ParticipantsTableProps {
    participants: Participant[];
    onViewDetails: (participantId: string) => void;
    researchId: string;
    onParticipantDeleted?: (participantId: string) => void;
    isLoading?: boolean;
    researchConfig?: ResearchConfiguration | null;
    readOnly?: boolean;
}

const statusConfig = {
    'In progress': {
        label: 'In progress',
        color: 'bg-blue-100 text-blue-800',
        icon: Clock
    },
    'Not started': {
        label: 'Not started',
        color: 'bg-gray-100 text-gray-800',
        icon: AlertCircle
    },
    'Completed': {
        label: 'Completed',
        color: 'bg-green-100 text-green-800',
        icon: CheckCircle
    },
    'Over quota': {
        label: 'Over quota',
        color: 'bg-orange-100 text-orange-800',
        icon: AlertTriangle
    },
    'Disqualified': {
        label: 'Disqualified',
        color: 'bg-red-100 text-red-800',
        icon: AlertTriangle
    }
};

/**
 * Tabla de participantes con funcionalidades de búsqueda, filtrado y acciones
 * @param participants - Lista de participantes
 * @param onViewDetails - Callback para ver detalles de un participante
 * @param researchId - ID de la investigación
 * @param onParticipantDeleted - Callback cuando se elimina un participante
 * @param isLoading - Estado de carga
 * @param researchConfig - Configuración de la investigación
 */
export function ParticipantsTable({
    participants,
    researchId,
    onParticipantDeleted,
    isLoading = false,
    // researchConfig - unused but kept for interface compatibility
    readOnly = false,
}: ParticipantsTableProps) {
    const toast = useToast();
    // Removed unused state variables
    // const [selectedParticipant, setSelectedParticipant] = useState<Participant | null>(null);
    // const [isModalOpen, setIsModalOpen] = useState(false);
    // const [participantDetails, setParticipantDetails] = useState<unknown>(null);

    const [participantToDelete, setParticipantToDelete] = useState<Participant | null>(null);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(new Set());
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [drawerDetails, setDrawerDetails] = useState<ParticipantDetails | null>(null);
    const [drawerLoading, setDrawerLoading] = useState(false);
    const [progressMin, setProgressMin] = useState(0);

    const handleViewDetails = async (participantId: string): Promise<void> => {
        setDrawerOpen(true);
        setDrawerLoading(true);
        setDrawerDetails(null);
        try {
            const response = await researchInProgressService.getParticipantDetails(researchId, participantId);
            if (response.success && response.data) {
                setDrawerDetails(response.data);
            }
        } catch {
            toast.error('Failed to load participant details');
        } finally {
            setDrawerLoading(false);
        }
    };
    const handleOpenReview = async (participantId: string): Promise<void> => {
        const reviewWindow = window.open('', '_blank');
        try {
            const reviewToken = await researchInProgressService.createParticipantReviewToken(researchId, participantId);
            if (reviewWindow) reviewWindow.location.href = getReviewUrl(researchId, participantId, reviewToken);
        } catch (err) {
            reviewWindow?.close();
            toast.error(`No se pudo abrir la revisión de ${participantId}: ${err instanceof Error ? err.message : String(err)}`);
        }
    };
    const selectAllCheckboxRef = useRef<HTMLInputElement>(null);

    const filteredParticipants = useMemo(() =>
        participants.filter(p => p.progress >= progressMin),
        [participants, progressMin]
    );

    const allFilteredSelected = useMemo(() => {
        return filteredParticipants.length > 0 &&
            filteredParticipants.every(p => selectedParticipantIds.has(p.id));
    }, [filteredParticipants, selectedParticipantIds]);

    const someFilteredSelected = useMemo(() => {
        return filteredParticipants.some(p => selectedParticipantIds.has(p.id));
    }, [filteredParticipants, selectedParticipantIds]);

    useEffect(() => {
        if (selectAllCheckboxRef.current) {
            selectAllCheckboxRef.current.indeterminate = someFilteredSelected && !allFilteredSelected;
        }
    }, [someFilteredSelected, allFilteredSelected]);

    const handleSelectAll = (checked: boolean): void => {
        if (checked) {
            const newSelected = new Set(selectedParticipantIds);
            filteredParticipants.forEach(p => newSelected.add(p.id));
            setSelectedParticipantIds(newSelected);
        } else {
            const newSelected = new Set(selectedParticipantIds);
            filteredParticipants.forEach(p => newSelected.delete(p.id));
            setSelectedParticipantIds(newSelected);
        }
    };

    const handleSelectParticipant = (participantId: string, checked: boolean): void => {
        const newSelected = new Set(selectedParticipantIds);
        if (checked) {
            newSelected.add(participantId);
        } else {
            newSelected.delete(participantId);
        }
        setSelectedParticipantIds(newSelected);
    };

    const getStatusConfig = (status: string) => {
        return statusConfig[status as keyof typeof statusConfig] || statusConfig['Not started'];
    };

    // Removed unused function
    // const handleParticipantClick = async (participant: Participant): Promise<void> => {
    //     setSelectedParticipant(participant);
    //     setIsModalOpen(true);
    //
    //     try {
    //         const response = await researchInProgressService.getParticipantDetails(researchId, participant.id);
    //
    //         if (response.success || response.status === 200) {
    //             setParticipantDetails(response.data);
    //         }
    //     } catch (error) {
    //         console.error('Error fetching participant details:', error);
    //         toast.error('Error al cargar los detalles del participante');
    //     }
    // };

    // Removed unused function
    // const handleCloseModal = (): void => {
    //     setIsModalOpen(false);
    //     setSelectedParticipant(null);
    //     setParticipantDetails(null);
    // };

    const handleDeleteClick = (participant: Participant): void => {
        setParticipantToDelete(participant);
        setIsDeleteModalOpen(true);
    };

    const handleDeleteParticipant = async (): Promise<void> => {
        if (!participantToDelete) return;

        setIsDeleting(true);

        try {
            const response = await researchInProgressService.deleteParticipant(researchId, participantToDelete.id);

            if (response.success) {
                onParticipantDeleted?.(participantToDelete.id);
                setIsDeleteModalOpen(false);
                setParticipantToDelete(null);
                toast.success('Participant deleted successfully');
            } else {
                toast.error('Failed to delete participant');
            }
        } catch {
            toast.error('Failed to delete participant');
        } finally {
            setIsDeleting(false);
        }
    };

    const handleDeleteSelected = (): void => {
        if (selectedParticipantIds.size === 0) return;
        setIsDeleteModalOpen(true);
        setParticipantToDelete(null);
    };

    const handleDeleteSelectedParticipants = async (): Promise<void> => {
        if (selectedParticipantIds.size === 0) return;

        setIsDeleting(true);

        try {
            const participantIdsArray = Array.from(selectedParticipantIds);
            const deletePromises = participantIdsArray.map(id =>
                researchInProgressService.deleteParticipant(researchId, id)
            );

            const results = await Promise.allSettled(deletePromises);
            const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
            const failed = results.length - successful;

            if (successful > 0) {
                participantIdsArray.forEach(id => onParticipantDeleted?.(id));
            }

            setIsDeleteModalOpen(false);
            setSelectedParticipantIds(new Set());

            if (failed > 0) {
                toast.error(`Deleted ${successful} participant(s). ${failed} failed.`);
            } else {
                toast.success(`${successful} participant(s) deleted successfully`);
            }
        } catch {
            toast.error('Failed to delete participants');
        } finally {
            setIsDeleting(false);
        }
    };

    const handleCloseDeleteModal = (): void => {
        setIsDeleteModalOpen(false);
        setParticipantToDelete(null);
        if (selectedParticipantIds.size > 0) {
            setSelectedParticipantIds(new Set());
        }
    };

    const SkeletonRow = () => (
        <tr className="border-b">
            <td className="py-3 px-4">
                <div className="animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-4"></div>
                </div>
            </td>
            <td className="py-3 px-4">
                <div className="animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-32 mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded w-48"></div>
                </div>
            </td>
            <td className="py-3 px-4">
                <div className="animate-pulse">
                    <div className="h-6 bg-gray-200 rounded w-20"></div>
                </div>
            </td>
            <td className="py-3 px-4">
                <div className="animate-pulse flex items-center gap-2">
                    <div className="w-20 h-2 bg-gray-200 rounded-full"></div>
                    <div className="h-3 bg-gray-200 rounded w-8"></div>
                </div>
            </td>
            <td className="py-3 px-4">
                <div className="animate-pulse">
                    <div className="h-3 bg-gray-200 rounded w-16"></div>
                </div>
            </td>
            <td className="py-3 px-4">
                <div className="animate-pulse">
                    <div className="h-3 bg-gray-200 rounded w-20"></div>
                </div>
            </td>
            <td className="py-3 px-4">
                <div className="animate-pulse flex items-center gap-2">
                    <div className="h-8 w-8 bg-gray-200 rounded"></div>
                    <div className="h-8 w-8 bg-gray-200 rounded"></div>
                </div>
            </td>
            <td className="py-3 px-4">
                <div className="animate-pulse flex items-center gap-2">
                    <div className="h-8 w-8 bg-gray-200 rounded"></div>
                    <div className="h-8 w-8 bg-gray-200 rounded"></div>
                </div>
            </td>
        </tr>
    );

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Eye className="h-5 w-5" />
                        Participants ({participants.length})
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {/* Progress minimum filter */}
                    <div className="flex items-center gap-4 mb-4 p-3 bg-gray-50 rounded-lg">
                        <span className="text-sm font-medium text-gray-600 whitespace-nowrap">Min. progress</span>
                        <input
                            type="range"
                            min={0}
                            max={100}
                            value={progressMin}
                            onChange={(e) => setProgressMin(Number(e.target.value))}
                            className="flex-1 max-w-xs h-1.5 accent-blue-600"
                        />
                        <span className="text-sm text-gray-700 font-medium w-10 text-right">{progressMin}%</span>
                        <span className="text-xs text-gray-500 whitespace-nowrap">
                            {filteredParticipants.length}/{participants.length}
                        </span>
                        {progressMin > 0 && (
                            <button
                                onClick={() => setProgressMin(0)}
                                className="text-xs text-blue-600 hover:text-blue-800"
                            >
                                Reset
                            </button>
                        )}
                    </div>

                    {selectedParticipantIds.size > 0 && (
                        <div className="flex items-center mb-4">
                            <Button
                                variant="danger"
                                size="sm"
                                onClick={handleDeleteSelected}
                                className="flex items-center gap-2"
                            >
                                <Trash2 className="h-4 w-4" />
                                Delete selected ({selectedParticipantIds.size})
                            </Button>
                        </div>
                    )}

                    <div className="overflow-auto max-h-[60vh]">
                        <table className="w-full">
                            <thead className="sticky top-0 bg-white z-10">
                                <tr className="border-b">
                                    {!readOnly && (
                                        <th className="text-left py-3 px-4 font-medium w-12">
                                            <input
                                                type="checkbox"
                                                ref={selectAllCheckboxRef}
                                                checked={allFilteredSelected}
                                                onChange={(e) => handleSelectAll(e.target.checked)}
                                                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                            />
                                        </th>
                                    )}
                                    <th className="text-left py-3 px-4 font-medium">Participant</th>
                                    <th className="text-left py-3 px-4 font-medium">Status</th>
                                    <th className="text-left py-3 px-4 font-medium">Progress</th>
                                    <th className="text-left py-3 px-4 font-medium">Duration</th>
                                    <th className="text-left py-3 px-4 font-medium">Last activity</th>
                                    {!readOnly && <th className="text-left py-3 px-4 font-medium">Actions</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {isLoading ? (
                                    Array.from({ length: 5 }).map((_, index) => (
                                        <SkeletonRow key={index} />
                                    ))
                                ) : filteredParticipants.length === 0 ? (
                                    <tr>
                                        <td colSpan={readOnly ? 6 : 7} className="py-16 text-center">
                                            <div className="flex flex-col items-center">
                                                <Users className="h-10 w-10 text-gray-300 mb-3" />
                                                <p className="text-sm font-semibold text-gray-700 mb-1">No participants yet</p>
                                                <p className="text-[13px] text-gray-400">Import participants via CSV or share the study link.</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredParticipants.map((participant) => {
                                        const status = getStatusConfig(participant.status);
                                        const StatusIcon = status.icon;

                                        return (
                                            <tr key={participant.id} className="border-b hover:bg-gray-50">
                                                {!readOnly && (
                                                    <td className="py-3 px-4">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedParticipantIds.has(participant.id)}
                                                            onChange={(e) => handleSelectParticipant(participant.id, e.target.checked)}
                                                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                                        />
                                                    </td>
                                                )}
                                                <td className="py-3 px-4">
                                                    <div>
                                                        <div className="font-medium">{participant.name}</div>
                                                        {participant.email && <div className="text-sm text-gray-500">{participant.email}</div>}
                                                    </div>
                                                </td>
                                                <td className="py-3 px-4">
                                                    <Badge className={status.color}>
                                                        <StatusIcon className="h-3 w-3 mr-1" />
                                                        {status.label}
                                                    </Badge>
                                                </td>
                                                <td className="py-3 px-4">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-20 bg-gray-200 rounded-full h-2">
                                                            <div
                                                                className="bg-blue-600 h-2 rounded-full"
                                                                style={{ width: `${participant.progress}%` }}
                                                            />
                                                        </div>
                                                        <span className="text-sm text-gray-600">{participant.progress}%</span>
                                                    </div>
                                                </td>
                                                <td className="py-3 px-4 text-gray-600">{participant.duration}</td>
                                                <td className="py-3 px-4 text-gray-600">{participant.lastActivity}</td>
                                                {!readOnly && (
                                                    <td className="py-3 px-4">
                                                        <div className="flex items-center gap-2">
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => handleViewDetails(participant.id)}
                                                                title="View details"
                                                            >
                                                                <Eye className="h-4 w-4" />
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => handleDeleteClick(participant)}
                                                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                                title="Delete participant"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {isDeleteModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                        <div className="flex items-center gap-3 mb-4">
                            <AlertTriangle className="h-6 w-6 text-red-500" />
                            <h3 className="text-lg font-semibold text-gray-900">
                                {participantToDelete ? 'Delete participant' : 'Delete selected participants'}
                            </h3>
                        </div>

                        {participantToDelete ? (
                            <>
                                <p className="text-gray-600 mb-6">
                                    Are you sure you want to delete <strong>{participantToDelete.name}</strong>{participantToDelete.email ? ` (${participantToDelete.email})` : ''}?
                                </p>
                                <p className="text-sm text-red-600 mb-6">
                                    This action cannot be undone. All participant data will be deleted.
                                </p>
                                <div className="flex gap-3 justify-end">
                                    <Button
                                        variant="outline"
                                        onClick={handleCloseDeleteModal}
                                        disabled={isDeleting}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        variant="danger"
                                        onClick={handleDeleteParticipant}
                                        disabled={isDeleting}
                                    >
                                        {isDeleting ? 'Deleting...' : 'Delete'}
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="text-gray-600 mb-6">
                                    Are you sure you want to delete <strong>{selectedParticipantIds.size}</strong> selected participant(s)?
                                </p>
                                <p className="text-sm text-red-600 mb-6">
                                    This action cannot be undone. All data for selected participants will be deleted.
                                </p>
                                <div className="flex gap-3 justify-end">
                                    <Button
                                        variant="outline"
                                        onClick={handleCloseDeleteModal}
                                        disabled={isDeleting}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        variant="danger"
                                        onClick={handleDeleteSelectedParticipants}
                                        disabled={isDeleting}
                                    >
                                        {isDeleting ? 'Deleting...' : `Delete ${selectedParticipantIds.size}`}
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            <Drawer
                isOpen={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                title={drawerDetails ? `Participant ${drawerDetails.id}` : 'Loading...'}
                width="md"
            >
                {drawerLoading ? (
                    <DrawerDetailsSkeleton />
                ) : drawerDetails ? (
                    <div className="space-y-6">
                        <Button variant="outline" size="sm" onClick={() => handleOpenReview(drawerDetails.id)}>
                            Ver como participante
                        </Button>
                        {/* Summary */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-3 bg-gray-50 rounded-lg">
                                <div className="text-xs text-gray-500">Status</div>
                                <div className="text-sm font-semibold">{drawerDetails.status}</div>
                            </div>
                            <div className="p-3 bg-gray-50 rounded-lg">
                                <div className="text-xs text-gray-500">Progress</div>
                                <div className="text-sm font-semibold">{drawerDetails.progress}%</div>
                            </div>
                            <div className="p-3 bg-gray-50 rounded-lg">
                                <div className="text-xs text-gray-500">Duration</div>
                                <div className="text-sm font-semibold">{drawerDetails.duration}</div>
                            </div>
                            <div className="p-3 bg-gray-50 rounded-lg">
                                <div className="text-xs text-gray-500">Last activity</div>
                                <div className="text-sm font-semibold">{drawerDetails.lastActivity}</div>
                            </div>
                        </div>

                        {/* Responses */}
                        {drawerDetails.responses && drawerDetails.responses.length > 0 ? (
                            <div>
                                <h4 className="text-sm font-semibold text-gray-700 mb-3">Responses ({drawerDetails.responses.length})</h4>
                                <div className="space-y-2">
                                    {(drawerDetails.responses as Array<{ moduleName?: string; componentId?: string; value?: unknown; createdAt?: string }>).map((r, i) => (
                                        <div key={i} className="p-3 border border-gray-100 rounded-lg text-sm">
                                            <div className="flex justify-between items-start mb-1">
                                                <span className="font-medium text-gray-800">{r.moduleName || 'Module'}</span>
                                                <span className="text-xs text-gray-400">{r.componentId}</span>
                                            </div>
                                            <div className="text-gray-600 break-all">
                                                {typeof r.value === 'string' ? r.value : JSON.stringify(r.value)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500 text-center py-4">No responses recorded</p>
                        )}
                    </div>
                ) : null}
            </Drawer>
        </>
    );
}