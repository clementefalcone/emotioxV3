const SIMPLE_ID = /^[A-Za-z][\w-]*$/;

const idStep = (id: string): string => (SIMPLE_ID.test(id) ? `#${id}` : `[id="${id.replace(/["\\]/g, '\\$&')}"]`);

const positionStep = (element: Element): string => {
    const tag = element.tagName.toLowerCase();
    const sameTag = Array.from(element.parentElement?.children ?? []).filter((sibling) => sibling.tagName === element.tagName);
    return sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(element) + 1})` : tag;
};

export const buildZoneSelector = (element: Element): string => {
    const steps: string[] = [];
    let current: Element | null = element;
    while (current && current.tagName.toLowerCase() !== 'html') {
        if (current.id) {
            steps.unshift(idStep(current.id));
            break;
        }
        if (current.tagName.toLowerCase() === 'body') {
            steps.unshift('body');
            break;
        }
        steps.unshift(positionStep(current));
        current = current.parentElement;
    }
    return steps.join(' > ');
};
