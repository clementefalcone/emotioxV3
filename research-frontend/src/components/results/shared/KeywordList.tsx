import { useState } from 'react';
import { cn } from '../../../lib/utils';
import { findQuotedEntries } from '../../../utils/quotedEntries';
import { MOOD_COLORS } from './moodColors';

interface KeywordListProps {
    keywords: Array<{ word: string; sentiment: string; supportingQuotes?: string[] }>;
    entries: Array<{ text: string; mood: string }>;
}

export const KeywordList = ({ keywords, entries }: KeywordListProps) => {
    const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);
    const selected = keywords.find(kw => kw.word === selectedKeyword);
    const matchingEntries = selected ? findQuotedEntries(selected.supportingQuotes, entries) : [];

    return (
        <>
            <div className="flex flex-wrap gap-2">
                {keywords.map(kw => {
                    const isActive = selectedKeyword === kw.word;
                    const realCount = findQuotedEntries(kw.supportingQuotes, entries).length;
                    const pctKw = entries.length > 0 ? Math.round((realCount / entries.length) * 100) : 0;
                    return (
                        <button
                            key={kw.word}
                            type="button"
                            onClick={() => setSelectedKeyword(isActive ? null : kw.word)}
                            className={cn(
                                'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                                isActive
                                    ? 'ring-2 ring-blue-400 ring-offset-1'
                                    : '',
                                kw.sentiment === 'positive' ? 'bg-green-50 text-green-700 hover:bg-green-100' :
                                kw.sentiment === 'negative' ? 'bg-red-50 text-red-700 hover:bg-red-100' :
                                'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            )}
                        >
                            {kw.word}
                            <span className="text-[10px] opacity-60">({realCount} · {pctKw}%)</span>
                        </button>
                    );
                })}
            </div>
            <div
                className="grid transition-[grid-template-rows] duration-300 ease-in-out"
                style={{ gridTemplateRows: selectedKeyword ? '1fr' : '0fr' }}
            >
                <div className="overflow-hidden">
                    {matchingEntries.length > 0 && (
                        <div className="border rounded-lg mt-1">
                            <div className="px-3 py-2 bg-gray-50 border-b text-xs text-gray-500 flex items-center justify-between">
                                <span>Comments containing "<span className="font-medium text-gray-700">{selectedKeyword}</span>"</span>
                                <span>{matchingEntries.length} results</span>
                            </div>
                            <div className="max-h-[240px] overflow-y-auto divide-y">
                                {matchingEntries.map((entry, ei) => (
                                    <div key={ei} className="flex items-center justify-between px-3 py-2">
                                        <span className="text-xs text-gray-700 flex-1 min-w-0 mr-3">{entry.text}</span>
                                        <span className={cn(
                                            'text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize flex-shrink-0',
                                            MOOD_COLORS[entry.mood] || MOOD_COLORS.indeterminate
                                        )}>
                                            {entry.mood}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};
