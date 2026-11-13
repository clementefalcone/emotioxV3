import { Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';

/**
 * Main dashboard layout
 * Includes Sidebar and main content area
 */
export const DashboardLayout = () => {
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const isAnalysisMode = searchParams.get('mode') === 'analysis';
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        setVisible(false);
        const id = requestAnimationFrame(() => setVisible(true));
        return () => cancelAnimationFrame(id);
    }, [location.pathname]);

    return (
        <div className="bg-[#f4f5f7] flex p-3 gap-3 h-screen w-screen overflow-hidden">
            {/* Sidebar */}
            {!isAnalysisMode && <Sidebar />}

            {/* Main Content */}
            <main
                className="rounded-xl bg-white border border-gray-200/60 w-full h-full overflow-hidden flex flex-col transition-opacity duration-200 ease-in-out"
                style={{ opacity: visible ? 1 : 0 }}
            >
                <Outlet />
            </main>
        </div>
    );
};
