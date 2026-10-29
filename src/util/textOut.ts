import { sanitizeDisplay } from './displayName';

/**
 * Escaping for exported text (Markdown report, clipboard, change log), where `displayName()` does
 * not apply because it truncates. `sanitizeDisplay` strips CR/LF with the other controls, which
 * would glue the words on both sides together, so line breaks become spaces first.
 */

/** One-line, sanitised, untruncated text for plain-text exports (change log). */
export function plainText(s: string): string {
  return sanitizeDisplay(String(s).replace(/\r\n|\r|\n/g, ' '));
}

/** plainText + GitHub-table-safe: every `|` becomes `\|`. */
export function mdEscape(s: string): string {
  return plainText(s).replace(/\|/g, '\\|');
}
