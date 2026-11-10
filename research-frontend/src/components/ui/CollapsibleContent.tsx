import { useEffect, useRef, useState, type ReactNode } from 'react';

export const CollapsibleContent = ({ expanded, children }: { expanded: boolean; children: ReactNode }) => {
    const contentRef = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState(0);

    useEffect(() => {
        if (contentRef.current) {
            setHeight(contentRef.current.scrollHeight);
        }
    }, [expanded, children]);

    return (
        <div
            className="overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out"
            style={{
                maxHeight: expanded ? height : 0,
                opacity: expanded ? 1 : 0,
            }}
        >
            <div ref={contentRef}>
                {children}
            </div>
        </div>
    );
};
