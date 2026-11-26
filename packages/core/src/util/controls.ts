/**
 * `text` without the C0/C1 controls that drive a terminal; tab and newline survive because they
 * only lay text out (an `ESC[2J` or `OSC 52` would clear the screen or write the clipboard).
 */
export function stripControls(text: string): string {
  return text.replace(/[^\P{Cc}\t\n]/gu, "");
}
