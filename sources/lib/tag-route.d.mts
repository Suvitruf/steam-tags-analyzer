export function tagSegment(id: number, name: string): string;
export function tagIdFromPath(pathname: string): number | null;
export function tagIdFromHash(hash: string): number | null;
export function tagPath(id: number, name: string, base?: string): string;
