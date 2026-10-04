import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
    LayoutDashboard,
    Boxes,
    ScrollText,
    History,
    Users,
    Wrench,
    UserPlus,
    LogOut,
    Settings,
    PanelLeftClose,
    PanelLeft,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useToast } from '../../hooks/useToast';
import { useAuthStore } from '../../stores/auth.store';

interface NavItem {
    path: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
}

const mainNav: NavItem[] = [
    { path: '/dashboard', label: 'Home', icon: LayoutDashboard },
    { path: '/research', label: 'Research', icon: Boxes },
    { path: '/research-tracking', label: 'Tracking', icon: ScrollText },
    { path: '/research-history', label: 'History', icon: History },
];

const manageNav: NavItem[] = [
    { path: '/clients', label: 'Clients', icon: Users },
    { path: '/research-types', label: 'Research Types', icon: Wrench },
    { path: '/modules', label: 'Modules', icon: Boxes },
];

export const StandardSidebar = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const toast = useToast();
    const logout = useAuthStore((state) => state.logout);
    const user = useAuthStore((state) => state.user);

    const [isCollapsed, setIsCollapsed] = useState(() => {
        const saved = localStorage.getItem('sidebar-collapsed');
        return saved ? JSON.parse(saved) : false;
    });

    useEffect(() => {
        localStorage.setItem('sidebar-collapsed', JSON.stringify(isCollapsed));
    }, [isCollapsed]);

    const handleLogout = async () => {
        try {
            await logout();
            navigate('/login');
        } catch {
            toast.error('Failed to sign out');
        }
    };

    const isActive = (path: string) =>
        location.pathname === path ||
        (path !== '/dashboard' && location.pathname.startsWith(path + '/'));

    const initials = user
        ? `${(user.first_name?.[0] ?? '').toUpperCase()}${(user.last_name?.[0] ?? '').toUpperCase()}`
        : '?';

    return (
        <div className={cn(
            "flex flex-col h-full rounded-xl flex-shrink-0 overflow-hidden transition-all duration-200 ease-out",
            "bg-white border border-gray-200/60",
            isCollapsed ? "w-[60px]" : "w-[240px]"
        )}>
            {/* Workspace header */}
            <div className="px-3 pt-3 pb-2 flex-shrink-0">
                <div className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors",
                    isCollapsed && "justify-center px-0"
                )}>
                    <img
                        src={`${import.meta.env.BASE_URL}EmotioCX-logo.svg`}
                        alt="EmotioCX"
                        className={cn(
                            "transition-all duration-200",
                            isCollapsed ? "h-7 w-7" : "h-6"
                        )}
                    />
                    {!isCollapsed && (
                        <button
                            onClick={() => setIsCollapsed(true)}
                            className="ml-auto p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                            title="Collapse sidebar"
                        >
                            <PanelLeftClose className="h-4 w-4" />
                        </button>
                    )}
                    {isCollapsed && (
                        <button
                            onClick={() => setIsCollapsed(false)}
                            className="absolute left-[60px] top-3 z-10 p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors opacity-0 group-hover:opacity-100"
                            title="Expand sidebar"
                        />
                    )}
                </div>
            </div>

            {/* Main nav */}
            <nav className="flex-1 px-2 py-1 overflow-y-auto scrollbar-hide min-h-0">
                <NavSection items={mainNav} isCollapsed={isCollapsed} isActive={isActive} />

                {/* Invite viewer */}
                <NavLink
                    onClick={() => navigate('/research?inviteViewer=1')}
                    icon={UserPlus}
                    label="Invite Viewer"
                    isCollapsed={isCollapsed}
                    active={false}
                />

                {/* Manage section */}
                {!isCollapsed && (
                    <div className="mt-5 mb-1.5 px-2">
                        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                            Manage
                        </span>
                    </div>
                )}
                {isCollapsed && <div className="my-2 mx-2 border-t border-gray-100" />}
                <NavSection items={manageNav} isCollapsed={isCollapsed} isActive={isActive} />
            </nav>

            {/* Footer: user + actions */}
            <div className="px-2 pb-3 pt-2 flex-shrink-0 space-y-1 border-t border-gray-100">
                {/* User indicator */}
                <div className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2 py-2",
                    isCollapsed && "justify-center"
                )}>
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                        <span className="text-[11px] font-semibold text-white leading-none">{initials}</span>
                    </div>
                    {!isCollapsed && (
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate leading-tight">
                                {user?.first_name} {user?.last_name}
                            </p>
                            <p className="text-[11px] text-gray-400 truncate leading-tight">
                                {user?.email}
                            </p>
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className={cn("flex gap-1", isCollapsed ? "flex-col items-center" : "")}>
                    {isCollapsed && (
                        <button
                            onClick={() => setIsCollapsed(false)}
                            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
                            title="Expand sidebar"
                        >
                            <PanelLeft className="h-4 w-4" />
                        </button>
                    )}
                    {!isCollapsed && (
                        <button
                            onClick={() => navigate('/profile')}
                            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
                            title="Settings"
                        >
                            <Settings className="h-3.5 w-3.5" />
                            Settings
                        </button>
                    )}
                    <button
                        onClick={handleLogout}
                        className={cn(
                            "flex items-center justify-center gap-1.5 rounded-lg text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors",
                            isCollapsed ? "p-2" : "flex-1 px-2 py-1.5"
                        )}
                        title="Logout"
                    >
                        <LogOut className="h-3.5 w-3.5" />
                        {!isCollapsed && 'Logout'}
                    </button>
                </div>
            </div>
        </div>
    );
};

/** Render a group of nav items */
function NavSection({ items, isCollapsed, isActive }: {
    items: NavItem[];
    isCollapsed: boolean;
    isActive: (path: string) => boolean;
}) {
    return (
        <div className="space-y-0.5">
            {items.map((item) => (
                <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                        'group relative flex items-center rounded-lg text-[13px] font-medium transition-all duration-150',
                        isActive(item.path)
                            ? 'bg-blue-50/80 text-blue-600'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                        isCollapsed ? 'px-0 py-2 justify-center' : 'px-2.5 py-[7px]'
                    )}
                    title={isCollapsed ? item.label : undefined}
                >
                    {/* Active indicator bar */}
                    {isActive(item.path) && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-blue-500 rounded-r-full" />
                    )}
                    <item.icon className={cn(
                        'h-[18px] w-[18px] flex-shrink-0',
                        isActive(item.path) ? 'text-blue-500' : 'text-gray-400 group-hover:text-gray-500',
                        !isCollapsed && 'mr-2.5'
                    )} />
                    {!isCollapsed && item.label}
                </Link>
            ))}
        </div>
    );
}

/** Single nav-like button (not a link) */
function NavLink({ onClick, icon: Icon, label, isCollapsed, active }: {
    onClick: () => void;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    isCollapsed: boolean;
    active: boolean;
}) {
    return (
        <button
            onClick={onClick}
            className={cn(
                'w-full group relative flex items-center rounded-lg text-[13px] font-medium transition-all duration-150',
                active
                    ? 'bg-blue-50/80 text-blue-600'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                isCollapsed ? 'px-0 py-2 justify-center' : 'px-2.5 py-[7px]'
            )}
            title={isCollapsed ? label : undefined}
        >
            <Icon className={cn(
                'h-[18px] w-[18px] flex-shrink-0',
                active ? 'text-blue-500' : 'text-gray-400 group-hover:text-gray-500',
                !isCollapsed && 'mr-2.5'
            )} />
            {!isCollapsed && label}
        </button>
    );
}
