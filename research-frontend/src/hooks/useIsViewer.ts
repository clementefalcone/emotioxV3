import { useAuthStore } from '../stores/auth.store';
import type { Research } from '../services/research.service';

/** Returns true if the current user has viewer (read-only) role. */
export function useIsViewer(): boolean {
  const role = useAuthStore((state) => state.user?.role);
  return role === 'viewer';
}

export function useIsResearchReadOnly(research?: Pick<Research, 'access_permission'>): boolean {
  const isViewer = useIsViewer();
  return isViewer || research?.access_permission === 'viewer';
}
