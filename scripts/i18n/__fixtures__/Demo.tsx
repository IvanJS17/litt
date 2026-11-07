"use client";

import { useState } from "react";
import { notify } from "@/app/lib/notify";

// Module-level text has no translator in scope: the codemod leaves it.
const FILTERS = [{ label: "All files" }];

export function MatterFiles({ count, user }: { count: number; user: { name: string } }) {
    const [open, setOpen] = useState(false);
    const save = () => notify("Saved your changes");
    const menu = [{ label: `Rename ${user.name}`, id: "rename" }];
    return (
        <section aria-label="Matter files" className="flex gap-2">
            <h2 title="Files shared in this matter">Files</h2>
            <input placeholder="Search files&hellip;" />
            <p>
                Welcome back, {user.name}. You have {count} {count === 1 ? "file" : "files"}.
            </p>
            <span>{`${count} ${count === 1 ? "matter" : "matters"} selected`}</span>
            <p>
                Don&apos;t lose
                your work
            </p>
            {open ? "Ready to go" : null}
            <button type="button" onClick={() => setOpen(true)}>
                LiTT
            </button>
            <ul>{FILTERS.concat(menu).map((item) => <li key={item.label}>{item.label}</li>)}</ul>
            <button type="button" onClick={save}>Save</button>
        </section>
    );
}

export const EmptyFiles = () => (
    <p>Nothing here yet</p>
);
