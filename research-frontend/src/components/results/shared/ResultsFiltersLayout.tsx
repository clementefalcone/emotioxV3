import { useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Drawer } from '../../ui/Drawer';

interface ResultsFiltersLayoutProps {
  readonly filters: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

export function ResultsFiltersLayout({ filters, children, className }: ResultsFiltersLayoutProps) {
  const [isFiltersDrawerOpen, setIsFiltersDrawerOpen] = useState(false);

  return (
    <div className={`flex gap-6 ${className ?? ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex justify-end mb-3 2xl:hidden">
          <button
            type="button"
            onClick={() => setIsFiltersDrawerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filtros
          </button>
        </div>
        {children}
      </div>
      <div className="hidden 2xl:block w-80 shrink-0 sticky top-0 self-start max-h-[calc(100vh-6rem)] overflow-y-auto">
        {filters}
      </div>
      <Drawer isOpen={isFiltersDrawerOpen} onClose={() => setIsFiltersDrawerOpen(false)} title="Filtros" width="sm">
        {filters}
      </Drawer>
    </div>
  );
}
