import { clientTranslator, notifyInfo, type UploadStorageSpace } from "@mike/client";

// One notice per space until the page is reloaded; the batch-level rule (ten
// files, one notice) is the upload client's. A plain notice, not an error, and
// it never blocks the upload. The text says the state in words and carries no
// figure.
const noticedSpaces = new Set<string>();

export function noticeStorageAlmostFull(space: UploadStorageSpace): void {
    const key = `${space.kind}:${space.id}`;
    if (noticedSpaces.has(key)) return;
    noticedSpaces.add(key);
    notifyInfo(
        clientTranslator()(
            space.kind === "firm"
                ? "documents.upload.storageAlmostFullFirm"
                : "documents.upload.storageAlmostFullPersonal",
        ),
    );
}
