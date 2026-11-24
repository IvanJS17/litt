import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownImageUI, withSafeMarkdownImages } from "./MarkdownImageUI";

describe("MarkdownImageUI", () => {
  it("draws an image from the page's own origin", () => {
    render(<MarkdownImageUI src="/x.png" alt="Local" title="t" node={{}} />);
    const img = screen.getByAltText("Local");
    expect(img).toHaveAttribute("src", "/x.png");
    expect(img).toHaveAttribute("title", "t");
    expect(img).not.toHaveAttribute("node");
    render(<MarkdownImageUI src={`${window.location.origin}/y.png`} />);
    expect(document.querySelectorAll("img")).toHaveLength(2);
  });

  it("links to an image from another site, with its alt text or address", () => {
    const { container } = render(
      <>
        <MarkdownImageUI src="https://other.example/p.png?d=1" alt=" Chart " />
        <MarkdownImageUI src="https://other.example/q.png" alt=" " />
      </>,
    );
    expect(container.querySelector("img")).toBeNull();
    const chart = screen.getByRole("link", { name: "Chart" });
    expect(chart).toHaveAttribute("href", "https://other.example/p.png?d=1");
    expect(chart).toHaveAttribute("target", "_blank");
    expect(chart).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: "https://other.example/q.png" })).toBeInTheDocument();
  });

  it("links to a protocol-relative address; draws nothing for an empty or unparsable one", () => {
    const { container } = render(
      <>
        <MarkdownImageUI src="//other.example/p.png" alt="P" />
        <MarkdownImageUI src="" alt="empty" />
        <MarkdownImageUI alt="none" />
        <MarkdownImageUI src="http://[bad" alt="bad" />
      </>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("link", { name: "P" })).toBeInTheDocument();
    expect(screen.queryByText("empty")).toBeNull();
    expect(screen.queryByText("bad")).toBeNull();
  });

  it("applies the rule last, whatever table a caller passes", () => {
    const table = withSafeMarkdownImages({ img: () => <img alt="own" src="https://other.example/a.png" />, p: () => null });
    expect(table.img).toBe(MarkdownImageUI);
    expect(typeof table.p).toBe("function");
    expect(withSafeMarkdownImages().img).toBe(MarkdownImageUI);
    const own = { p: () => null };
    expect(withSafeMarkdownImages(own)).toBe(withSafeMarkdownImages(own));
    expect(own).not.toHaveProperty("img");
  });

  it("returns frozen tables: a later assignment cannot change the image rule for other callers", () => {
    const own = { p: () => null };
    const tables = [withSafeMarkdownImages(), withSafeMarkdownImages(own)];
    for (const table of tables) {
      expect(Object.isFrozen(table)).toBe(true);
      // Modules are strict: the assignment throws, which is fine; either way the rule stays.
      expect(() => {
        (table as { img: unknown }).img = () => <img alt="x" src="https://other.example/p.png" />;
      }).toThrow(TypeError);
      expect(table.img).toBe(MarkdownImageUI);
    }
    expect(withSafeMarkdownImages().img).toBe(MarkdownImageUI);
    expect(withSafeMarkdownImages(own).img).toBe(MarkdownImageUI);
  });

  it("draws a same-origin image with only the props an image needs", () => {
    const extra = {
      srcSet: "https://other.example/a.png 2x",
      sizes: "100vw",
      style: { backgroundImage: "url(https://other.example/b.png)" },
      onError: () => {},
      onLoad: () => {},
      onClick: () => {},
      "data-x": "1",
      id: "i",
      referrerPolicy: "unsafe-url",
      crossOrigin: "anonymous",
    };
    const { container } = render(
      <MarkdownImageUI
        src="/x.png"
        alt="A"
        title="T"
        width={10}
        height={20}
        className="c"
        loading="lazy"
        decoding="async"
        {...(extra as object)}
      />,
    );
    const img = container.querySelector("img")!;
    expect(img.getAttributeNames().sort()).toEqual(["alt", "class", "decoding", "height", "loading", "src", "title", "width"]);
    expect(img).toHaveAttribute("src", "/x.png");
  });
});
