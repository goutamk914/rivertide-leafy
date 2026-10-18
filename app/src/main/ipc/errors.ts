/**
 * Turns validation and handler failures into short sentences a renderer can show as-is.
 */
import { ZodError } from 'zod';

export const NOT_ALLOWED_MESSAGE = "This part of Rivertide isn't allowed to do that.";
export const GENERIC_FAILURE_MESSAGE = 'Something went wrong. Please try again.';

/** "That request wasn't valid: voice.endSilenceMs — Too big: expected number to be <=5000." */
export function describeZodError(error: ZodError, intro = "That request wasn't valid"): string {
  const issue = error.issues[0];
  if (!issue) return `${intro}.`;
  const path = issue.path.map(String).join('.');
  const message = issue.message.replace(/\.+$/, '');
  return `${intro}: ${path ? `${path} — ` : ''}${message}.`;
}

export function isZodError(error: unknown): error is ZodError {
  return error instanceof ZodError;
}

/** Errors crossing IPC lose their type; keep only a readable message. */
export function toUserError(error: unknown): Error {
  if (isZodError(error)) return new Error(describeZodError(error));
  if (error instanceof Error && error.message.trim()) return new Error(error.message);
  return new Error(GENERIC_FAILURE_MESSAGE);
}
