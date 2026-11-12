// Compare two Word files and return a third with the differences as tracked
// changes (w:ins / w:del / w:rPrChange). Engine: Docxodus (MIT), the npm
// package `docxodus`, a .NET engine compiled to WebAssembly. It runs only in
// the isolated parser process (the `docxCompare` op), which gives it a size,
// time and memory bound; it reads its .wasm from node_modules and never opens
// a network connection.
//
// The op takes ONE buffer, so the two files travel together: a 4-byte
// big-endian length of the original, the original, then the modified file.

/** The name tracked changes carry. A fixed name, not the person's: the file may leave the account. */
export const COMPARE_AUTHOR = "LiTT";

export function packComparePair(original: ArrayBuffer, modified: ArrayBuffer): ArrayBuffer {
    const out = Buffer.alloc(4 + original.byteLength + modified.byteLength);
    out.writeUInt32BE(original.byteLength, 0);
    out.set(new Uint8Array(original), 4);
    out.set(new Uint8Array(modified), 4 + original.byteLength);
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

function unpackComparePair(packed: ArrayBuffer): { original: Uint8Array; modified: Uint8Array } {
    const view = new Uint8Array(packed);
    const length = Buffer.from(packed, 0, 4).readUInt32BE(0);
    if (length > view.byteLength - 4) throw new Error("compare input is malformed");
    return { original: view.subarray(4, 4 + length), modified: view.subarray(4 + length) };
}

// docxodus is ES-module only; a real dynamic import() (kept by module Node16) loads it from CommonJS.
const importEngine = () => import("docxodus/core");
type Engine = Awaited<ReturnType<typeof importEngine>>;
let engine: Promise<Engine> | null = null;

/** Load the engine once per parser process; the WASM stays warm until the process retires. */
function loadEngine(): Promise<Engine> {
    engine ??= (async () => {
        const mod = await importEngine();
        await mod.initialize();
        return mod;
    })().catch((error) => {
        engine = null;
        throw error;
    });
    return engine;
}

/** Throws when either file is not a readable Word package. */
export async function compareDocx(packed: ArrayBuffer): Promise<Uint8Array> {
    const { original, modified } = unpackComparePair(packed);
    const { docxDiffCompare } = await loadEngine();
    // Engine defaults otherwise (move detection included: turning it off is worse). The default
    // revision date is a fixed 2000-01-01; the changes are made now, so say so.
    return docxDiffCompare(original, modified, {
        authorForRevisions: COMPARE_AUTHOR,
        dateTimeForRevisions: new Date().toISOString(),
    });
}
