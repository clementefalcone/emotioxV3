import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../../contexts/ToastContext';
import { useAuthStore } from '../../../stores/auth.store';
import { StandardSidebar } from '../StandardSidebar';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });

describe('StandardSidebar — Settings', () => {
    it('opens the account page', () => {
        useAuthStore.setState({ user: { role: 'researcher', first_name: 'Ana', last_name: 'Diaz', email: 'a@x.com' } } as never);
        render(
            <ToastProvider>
                <MemoryRouter initialEntries={['/dashboard']}>
                    <Routes>
                        <Route path="/dashboard" element={<StandardSidebar />} />
                        <Route path="/profile" element={<p>account page</p>} />
                    </Routes>
                </MemoryRouter>
            </ToastProvider>,
        );

        fireEvent.click(screen.getByTitle('Settings'));

        expect(screen.getByText('account page')).toBeInTheDocument();
    });
});
