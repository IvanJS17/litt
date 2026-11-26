/**
 * The one place a stored document text is put together from the database.
 *
 * No answer of the database carries a whole text: the SQL functions return at
 * most TEXT_SLICE_CHARS characters (a few MiB of JSON even for control
 * characters) and say how long the whole text is. A caller that needs the whole
 * text gets it here, slice after slice; a caller that needs a window asks for
 * just that window. Keep TEXT_SLICE_CHARS equal to the bound in
 * read_document_text and document_text_slice.
 */
export const TEXT_SLICE_CHARS = 500_000;

type Slice = { revision?: string; text: string | null; text_length: number | null };

const countCharacters = (text: string): number => {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
};

/**
 * `fetchSlice(offset, length)` returns one slice (characters are Unicode code
 * points, as in the database) or null when the text is no longer there. With
 * `window` only that window is read; without it, the whole text. The slices of
 * one reading must be of one revision: a text replaced in between is an error,
 * never a splice of two texts.
 */
export async function readTextSlices<T extends Slice>(
  fetchSlice: (offset: number, length: number) => Promise<T | null>,
  window: { offset?: number; maxChars?: number } = {},
): Promise<T | null> {
  const start = Math.max(0, window.offset ?? 0);
  const want = window.maxChars ?? Number.POSITIVE_INFINITY;
  const first = await fetchSlice(start, Math.min(want, TEXT_SLICE_CHARS));
  if (!first || first.text === null || first.text_length === null) return first;
  const parts = [first.text];
  let got = countCharacters(first.text);
  while (got < want && start + got < first.text_length) {
    const next = await fetchSlice(start + got, Math.min(want - got, TEXT_SLICE_CHARS));
    if (!next || next.text === null || (next.revision ?? first.revision) !== first.revision
      || next.text_length !== first.text_length) {
      throw new Error("The stored text changed while it was being read");
    }
    const n = countCharacters(next.text);
    if (n === 0) break;
    parts.push(next.text);
    got += n;
  }
  return { ...first, text: parts.join("") };
}
