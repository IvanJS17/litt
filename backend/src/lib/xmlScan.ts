/**
 * The one place where the XML of an Office file (a slide, a Word body, its
 * styles) is scanned for elements by name. That XML comes from an uploaded
 * file, so the scan reads it once, forward only:
 *
 *   - the next `>` and, for each name, the next closing tag are searched from
 *     a cursor that never moves back, and a search that found nothing is never
 *     repeated (a start tag with no `>` or no closing tag ends or skips the
 *     scan, it does not start a new search from every later start tag);
 *   - no regular expression reads the text.
 *
 * The rules are those of the expressions it replaced
 * (`<name\b[^>]*>([\s\S]*?)</name>`): a start tag is `<` and the name, then
 * anything that is not a word character, up to the FIRST `>` (a `>` inside a
 * quoted attribute value ends it too); an element ends at the first closing
 * tag after its start tag, so a nested element of the same name is not
 * balanced; CDATA sections and comments are not recognised. Names are
 * compared as written: XML names are case-sensitive.
 */

/** An element found by `scanXmlElements`. */
export type XmlElement = {
    name: string;
    /** What follows the name in the start tag, without the closing `>` (a self-closing tag ends in `/`). */
    attrs: string;
    /** The start tag ends in `/>`: the element is empty and has no closing tag. */
    selfClosing: boolean;
    /** The text between the start tag and the closing tag; empty for a self-closing or start-tag-only element. */
    inner: string;
    /** The whole element, from `<` to the end of its closing tag (or of its start tag). */
    outer: string;
    /** Where the element ends in the scanned text. */
    end: number;
};

/** `\w` of a regular expression without the `u` flag. */
const isWordChar = (code: number) =>
    (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;

/**
 * The elements of `xml` named in `containers` (start tag, body, closing tag)
 * and the start tags named in `tags` (no body, no closing tag), in document
 * order. A name only matches when no word character follows it
 * (`w:t` is not `w:tab`). After a container, the scan goes on past its closing
 * tag; after a start tag, past the tag. A container whose closing tag is
 * missing is skipped, and so is every later one of its name; the others are
 * still found. The scan ends at the first start tag with no `>` after it.
 *
 * Cost: proportional to the length of `xml`, whatever its shape.
 */
export function* scanXmlElements(
    xml: string,
    containers: readonly string[],
    tags: readonly string[] = [],
): Generator<XmlElement> {
    const names = [...containers, ...tags];
    const isContainer = (index: number) => index < containers.length;
    const closeTags = names.map((name) => `</${name}>`);
    // The next closing tag of each name at or after the last position asked for; -2 not searched yet, -1 none left.
    const closeAt = names.map(() => -2);
    // The first `>` at or after the last start tag; -2 not searched yet.
    let gt = -2;
    let pos = 0;
    for (;;) {
        const lt = xml.indexOf("<", pos);
        if (lt < 0) return;
        pos = lt + 1;
        let index = -1;
        for (let i = 0; i < names.length; i++) {
            if (xml.startsWith(names[i], lt + 1) && !isWordChar(xml.charCodeAt(lt + 1 + names[i].length))) {
                index = i;
                break;
            }
        }
        if (index < 0) continue;
        const name = names[index];
        const nameEnd = lt + 1 + name.length;
        if (gt !== -1 && gt < nameEnd) gt = xml.indexOf(">", nameEnd);
        // No `>` after this start tag: none after a later one either.
        if (gt === -1) return;
        const attrs = xml.slice(nameEnd, gt);
        const selfClosing = attrs.endsWith("/");
        if (!isContainer(index) || selfClosing) {
            pos = gt + 1;
            yield { name, attrs, selfClosing, inner: "", outer: xml.slice(lt, gt + 1), end: gt + 1 };
            continue;
        }
        let close = closeAt[index];
        if (close === -2 || (close >= 0 && close <= gt)) {
            close = xml.indexOf(closeTags[index], gt + 1);
            closeAt[index] = close;
        }
        // No closing tag after this start tag: none after a later one of this name either.
        if (close < 0) continue;
        const end = close + closeTags[index].length;
        pos = end;
        yield { name, attrs, selfClosing: false, inner: xml.slice(gt + 1, close), outer: xml.slice(lt, end), end };
    }
}

/** The first element `scanXmlElements` finds, or null. */
export function firstXmlElement(
    xml: string,
    containers: readonly string[],
    tags: readonly string[] = [],
): XmlElement | null {
    for (const element of scanXmlElements(xml, containers, tags)) return element;
    return null;
}

/**
 * The value of the first attribute `name="value"` (double quotes, no space
 * around the `=`) in the attributes of a start tag, as written (entities are
 * not decoded); null when there is none. A name inside a longer one
 * (`xw:val`) is not it.
 */
export function xmlAttribute(attrs: string, name: string): string | null {
    const needle = `${name}="`;
    for (let at = attrs.indexOf(needle); at >= 0; at = attrs.indexOf(needle, at + 1)) {
        if (at > 0 && isWordChar(attrs.charCodeAt(at - 1))) continue;
        const start = at + needle.length;
        const end = attrs.indexOf('"', start);
        return end < 0 ? null : attrs.slice(start, end);
    }
    return null;
}
