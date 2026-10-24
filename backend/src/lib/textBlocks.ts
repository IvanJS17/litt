/**
 * Linear delimited-block extraction.
 *
 * A regular expression such as `<CITATIONS>\s*([\s\S]*?)\s*</CITATIONS>` looks
 * equivalent but is quadratic: the `\s*` after the open tag consumes a long
 * run of whitespace and then backtracks it character by character, so a
 * missing close tag over a large answer (the block is parsed repeatedly while
 * the answer streams) spends unbounded time. Two index scans are linear and
 * cannot be driven into that state by model output or document text.
 */
export function extractDelimitedBlock(
  text: string,
  openTag: string,
  closeTag: string,
): string | null {
  const openIndex = text.indexOf(openTag);
  if (openIndex < 0) return null;
  const contentStart = openIndex + openTag.length;
  const closeIndex = text.indexOf(closeTag, contentStart);
  if (closeIndex < 0) return null;
  return text.slice(contentStart, closeIndex).trim();
}
