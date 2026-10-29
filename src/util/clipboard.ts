/**
 * Copies plain text with the async Clipboard API. Resolves `false` (never rejects) when the API is
 * missing (insecure context, older browser) or the write is refused, so the caller can show a
 * selectable `<CopyFallback>` instead (as tbs.models does).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!(window.isSecureContext && navigator.clipboard)) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
