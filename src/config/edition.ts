export type BuildEdition = 'full' | 'trial';

/**
 * A full build is the vendor's own copy: pre-activated and carrying the code
 * generator. A trial build unlocks only through a supplier code and never
 * exposes the vendor console. Anything without an explicit flag counts as full
 * so local development keeps the generator.
 */
export const BUILD_EDITION: BuildEdition =
  import.meta.env.VITE_BUILD_EDITION === 'trial' ? 'trial' : 'full';

export const IS_FULL_EDITION = BUILD_EDITION === 'full';
