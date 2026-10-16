import { useState } from 'react';
import { ChevronDown, MessageSquareQuote } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { MOOD_COLORS } from './moodColors';

interface ThemeCardProps {
    name: string;
    description: string;
    mentions: Array<{ text: string; mood: string }>;
    totalEntries: number;
}

export const ThemeCard = ({ name, description, mentions, totalEntries }: ThemeCardProps) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const pct = totalEntries > 0 ? Math.round((mentions.length / totalEntries) * 100) : 0;

    return (
        <div className="bg-gray-50 rounded-lg overflow-hidden">
            <button
                type="button"
                onClick={() => setIsExpanded(prev => !prev)}
                className="w-full text-left p-3 cursor-pointer hover:bg-gray-100 transition-colors"
            >
                <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{name}</span>
                        <ChevronDown className={cn(
                            'w-3.5 h-3.5 text-gray-400 transition-transform',
                            isExpanded && 'rotate-180'
                        )} />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-blue-600">{pct}%</span>
                        <span className="text-xs text-gray-500">{mentions.length} mentions</span>
                    </div>
                </div>
                <div className="w-full h-1.5 bg-gray-200 rounded-full mb-2">
                    <div
                        className="h-full bg-blue-500 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                    />
                </div>
                <p className="text-xs text-gray-600">{description}</p>
            </button>
            <div
                className="grid transition-[grid-template-rows] duration-300 ease-in-out"
                style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
            >
                <div className="overflow-hidden">
                    <div className="px-3 pb-3 border-t border-gray-200 pt-2">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1.5">
                                <MessageSquareQuote className="w-3 h-3 text-gray-400" />
                                <span className="text-[11px] font-medium text-gray-500">Matching entries</span>
                            </div>
                            <span className="text-[10px] text-gray-400">{mentions.length} results</span>
                        </div>
                        <div className="max-h-[240px] overflow-y-auto space-y-1">
                            {mentions.map((entry, qi) => (
                                <div key={qi} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-white transition-colors">
                                    <p className="text-xs text-gray-600 italic flex-1 min-w-0 mr-3">"{entry.text}"</p>
                                    <span className={cn(
                                        'text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize flex-shrink-0',
                                        MOOD_COLORS[entry.mood] || MOOD_COLORS.indeterminate
                                    )}>
                                        {entry.mood}
                                    </span>
                                </div>
                            ))}
                            {mentions.length === 0 && (
                                <p className="text-xs text-gray-400 italic">No matching entries found</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
