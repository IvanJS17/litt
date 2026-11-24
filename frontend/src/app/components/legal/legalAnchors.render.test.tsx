import { render } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { withSafeMarkdownImages } from "@mike/ui";
import { rehypeLegalAnchors } from "./legalAnchors";

// The plugin is local code that the architecture rule lists but cannot read:
// this test shows it changes nothing but `id`.
const SAMPLE = [
    "# Title",
    "",
    "## 1. First",
    "",
    "1. one ![a](/x.png) and ![b](https://other.example/p.png?d=1)",
    "2. two <img src=\"https://other.example/h.png\" srcset=\"https://other.example/s.png 2x\"> <video poster=\"https://other.example/v.png\"></video>",
    "",
    "## 2. Second",
    "",
    "<picture><source srcset=\"https://other.example/s.png\"></picture>",
    "",
    "- item [link](https://other.example/) <link rel=\"preload\" href=\"https://other.example/l.png\">",
    "",
    "## 3. Third",
    "",
    "1. a",
    "1. b",
].join("\n");

const draw = (plugins: (typeof rehypeLegalAnchors)[]) =>
    render(
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={plugins} components={withSafeMarkdownImages()}>
            {SAMPLE}
        </ReactMarkdown>,
    ).container;

describe("rehypeLegalAnchors", () => {
    it("adds ids and nothing else: no element renamed and no src, srcset, poster or href set", () => {
        const plain = draw([]);
        const anchored = draw([rehypeLegalAnchors]);
        const ids = Array.from(anchored.querySelectorAll("[id]")).map((el) => el.getAttribute("id"));
        expect(ids).toEqual(["1", "1-1", "1-2", "2", "3", "3-1", "3-2"]);
        const withoutIds = (root: HTMLElement) => {
            const copy = root.cloneNode(true) as HTMLElement;
            copy.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
            return copy.innerHTML;
        };
        expect(withoutIds(anchored)).toBe(withoutIds(plain));
        const added = (name: string) => anchored.querySelectorAll(`[${name}]`).length - plain.querySelectorAll(`[${name}]`).length;
        for (const name of ["src", "srcset", "poster", "href"]) expect(added(name), name).toBe(0);
        expect(anchored.querySelector("img[src*='other.example'], video, source, link")).toBeNull();
    });
});
