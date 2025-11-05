declare module 'micromatch' {
  export type MatcherPattern = string | ReadonlyArray<string>;
  export interface MatcherOptions {
    nocase?: boolean;
    noglobstar?: boolean;
  }

  export function isMatch(
    value: string,
    pattern: MatcherPattern,
    options?: MatcherOptions,
  ): boolean;

  const micromatch: {
    isMatch: typeof isMatch;
  };

  export default micromatch;
}
