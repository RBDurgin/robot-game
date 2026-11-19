/** Hand the player a text file to save. */
export function downloadText(fileName: string, text: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  link.download = fileName;
  link.click();
  // Not at once: the browser is still reading it.
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

/**
 * A slot's stored text as a save file the import button reads: the save inside it if it can
 * be found, otherwise the text exactly as it was.
 */
export function slotAsSaveFile(raw: string): string {
  try {
    const stored = JSON.parse(raw) as { save?: unknown } | null;
    if (stored && typeof stored === "object" && stored.save && typeof stored.save === "object") return JSON.stringify(stored.save, null, 2);
  } catch {
    // Not JSON: hand it over as it is.
  }
  return raw;
}
