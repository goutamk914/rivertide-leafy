/** A failed OS action with a message that is safe and useful to show (or speak) to the user. */
export class OsActionError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = 'OsActionError';
  }
}

export const NOT_AVAILABLE = 'That isn’t available on this computer yet.';

export const notAvailable = (what: string): OsActionError => new OsActionError(`${what} isn’t available on this computer yet.`);

export const isOsActionError = (error: unknown): error is OsActionError => error instanceof OsActionError;

/** Message to show for any error thrown by an OS action. */
export const osErrorMessage = (error: unknown, fallback: string): string =>
  isOsActionError(error) ? error.message : fallback;
