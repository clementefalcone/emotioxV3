// Re-export all research service functions for backward compatibility
// Previously in research.service.ts (1847 lines), now split into domain files

export { buildOwnershipClause, type ResearchData } from './research.helpers';
export { create } from './research.create';
export { list, listByEnterprise, getById, update, updateStatus, activate, deleteResearch } from './research.crud';
export { createStage, deleteStage, updateModulesOrderInStage, reorderStages, deleteModule, addWelcomeAndThankYouStages } from './research.stages';
export { duplicate } from './research.duplicate';
export { listCollaborators, addCollaborator, removeCollaborator, COLLABORATOR_PERMISSIONS } from './research.collaborators';
