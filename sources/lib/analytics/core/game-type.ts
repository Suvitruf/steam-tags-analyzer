/** Latest observed final price, not a verified business model or launch price. */
export type GameType = 'all' | 'paid' | 'free';
export function gameType(value: string | null | undefined): GameType {
  if (value == null || value === 'all') return 'all';
  if (value === 'paid' || value === 'free') return value;
  throw Error(`Invalid game type: ${value}`);
}
export function matchesGameType(price: number | null, type: GameType = 'all'): boolean {
  return type === 'all' || (type === 'free' ? price === 0 : price !== null && price > 0);
}
export function populationFile(file: string, type: GameType): string {
  return type === 'all' ? file : `populations/${type}/${file}`;
}
