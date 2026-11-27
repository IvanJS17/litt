import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useInertVectorImages, VECTOR_IMAGE_BYTE_LIMIT } from "./useInertVectorImages";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>';
const blobs = new Map<string, Blob>();
const fetchMock = vi.fn(async (url: string) => {
    const blob = blobs.get(url);
    if (!blob) throw new TypeError("unknown object URL");
    return { blob: async () => blob } as Response;
});

function Host() {
    const ref = useRef<HTMLDivElement>(null);
    useInertVectorImages(ref);
    return <div ref={ref} data-testid="host" />;
}

function mount() {
    const view = render(<Host />);
    return { host: view.getByTestId("host"), unmount: view.unmount };
}

function addImage(host: HTMLElement, url: string, blob: Blob, alt = "") {
    blobs.set(url, blob);
    const img = document.createElement("img");
    img.setAttribute("alt", alt);
    img.setAttribute("src", url);
    host.append(img);
    return img;
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
const dataUrlOf = (type: string, text: string) => `data:${type};base64,${btoa(text)}`;

beforeEach(() => {
    blobs.clear();
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it("shows a vector image from a data URL holding the same bytes", async () => {
    const { host } = mount();
    const img = addImage(host, "blob:http://app.test/vector-1", new Blob([SVG], { type: "image/svg+xml" }), "logo");
    await settle();
    expect(img.getAttribute("src")).toBe(dataUrlOf("image/svg+xml", SVG));
    expect(img.getAttribute("alt")).toBe("logo");
});

it("leaves raster images exactly as they are", async () => {
    const { host } = mount();
    const types = ["image/png", "image/jpeg", "image/gif", "image/webp"];
    const images = types.map((type, index) => addImage(host, `blob:http://app.test/raster-${index}`, new Blob(["bytes"], { type })));
    await settle();
    images.forEach((img, index) => expect(img.getAttribute("src")).toBe(`blob:http://app.test/raster-${index}`));
});

it("replaces an element that is added again with a known object URL without a second read", async () => {
    const { host } = mount();
    const first = addImage(host, "blob:http://app.test/vector-2", new Blob([SVG], { type: "image/svg+xml" }));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    first.remove();
    const again = document.createElement("img");
    again.setAttribute("src", "blob:http://app.test/vector-2");
    host.append(again);
    await act(async () => { await Promise.resolve(); });
    expect(again.getAttribute("src")).toBe(dataUrlOf("image/svg+xml", SVG));
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("replaces an image whose source is changed to an object URL of a vector image", async () => {
    const { host } = mount();
    const img = addImage(host, "blob:http://app.test/raster-a", new Blob(["x"], { type: "image/png" }));
    await settle();
    blobs.set("blob:http://app.test/vector-3", new Blob([SVG], { type: "image/svg+xml" }));
    img.setAttribute("src", "blob:http://app.test/vector-3");
    await settle();
    expect(img.getAttribute("src")).toBe(dataUrlOf("image/svg+xml", SVG));
});

it("treats an empty or generic type with an svg root as a vector image", async () => {
    const { host } = mount();
    const empty = addImage(host, "blob:http://app.test/empty", new Blob([`<?xml version="1.0"?>\n<!-- c -->\n${SVG}`]));
    const generic = addImage(host, "blob:http://app.test/generic", new Blob([SVG], { type: "application/octet-stream" }));
    const notVector = addImage(host, "blob:http://app.test/other", new Blob(["plain bytes"], { type: "" }));
    await settle();
    expect(empty.getAttribute("src")).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(generic.getAttribute("src")).toBe(dataUrlOf("image/svg+xml", SVG));
    expect(notVector.getAttribute("src")).toMatch(/^data:image\/gif;base64,/);
});

it("keeps an object URL only on a declared image type that is not a vector image; any other type gets the placeholder", async () => {
    const { host } = mount();
    const markup = '<html xmlns="http://www.w3.org/1999/xhtml"><body>text</body></html>';
    const others = ["text/html", "application/xhtml+xml", "application/xml", "text/xml", "text/plain", "application/octet-stream", "", "application/pdf"]
        .map((type, index) => addImage(host, `blob:http://app.test/other-${index}`, new Blob([markup], { type }), "figure"));
    const kept = ["image/png", "image/bmp", "image/tiff", "image/x-emf", "IMAGE/JPEG; q=1"]
        .map((type, index) => addImage(host, `blob:http://app.test/kept-${index}`, new Blob([markup], { type })));
    await settle();
    others.forEach((img) => {
        expect(img.getAttribute("src")).toMatch(/^data:image\/gif;base64,/);
        expect(img.getAttribute("alt")).toBe("figure");
    });
    kept.forEach((img, index) => expect(img.getAttribute("src")).toBe(`blob:http://app.test/kept-${index}`));
});

it("shows an inert placeholder, keeping the alt text, for a vector image over the size limit", async () => {
    const { host } = mount();
    const big = `<svg xmlns="http://www.w3.org/2000/svg">${" ".repeat(VECTOR_IMAGE_BYTE_LIMIT)}</svg>`;
    const img = addImage(host, "blob:http://app.test/big", new Blob([big], { type: "image/svg+xml" }), "large drawing");
    await settle();
    expect(img.getAttribute("src")).toMatch(/^data:image\/gif;base64,/);
    expect(img.getAttribute("alt")).toBe("large drawing");
});

it("does not leave an object URL on an image that cannot be read", async () => {
    const { host } = mount();
    const img = document.createElement("img");
    img.setAttribute("src", "blob:http://app.test/revoked");
    host.append(img);
    await settle();
    expect(img.getAttribute("src")).toMatch(/^data:image\/gif;base64,/);
});

it("handles images that exist before the effect starts and nested ones", async () => {
    blobs.set("blob:http://app.test/nested", new Blob([SVG], { type: "image/svg+xml" }));
    const view = render(<Host />);
    const host = view.getByTestId("host");
    const wrapper = document.createElement("div");
    const img = document.createElement("img");
    img.setAttribute("src", "blob:http://app.test/nested");
    wrapper.append(img);
    host.append(wrapper);
    await settle();
    expect(img.getAttribute("src")).toBe(dataUrlOf("image/svg+xml", SVG));
});

it("stops observing and ignores pending reads after unmount", async () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const { host, unmount } = mount();
    const img = addImage(host, "blob:http://app.test/late", new Blob([SVG], { type: "image/svg+xml" }));
    unmount();
    await settle();
    expect(disconnect).toHaveBeenCalled();
    expect(img.getAttribute("src")).toBe("blob:http://app.test/late");
    disconnect.mockRestore();
});

it("ignores text, other elements and images without an object URL, and a missing host", async () => {
    function Detached() {
        useInertVectorImages({ current: null });
        return null;
    }
    render(<Detached />);
    const { host } = mount();
    const plain = document.createElement("img");
    plain.setAttribute("src", "https://example.test/a.png");
    const withoutSource = document.createElement("img");
    const other = document.createElement("div");
    host.append("text", plain, withoutSource, other);
    other.setAttribute("src", "blob:http://app.test/not-an-image");
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(plain.getAttribute("src")).toBe("https://example.test/a.png");
});

it("reads an object URL once when several images wait for it", async () => {
    const { host } = mount();
    const first = addImage(host, "blob:http://app.test/shared", new Blob([SVG], { type: "image/svg+xml" }));
    const second = addImage(host, "blob:http://app.test/shared", new Blob([SVG], { type: "image/svg+xml" }));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.getAttribute("src")).toBe(dataUrlOf("image/svg+xml", SVG));
    expect(second.getAttribute("src")).toBe(dataUrlOf("image/svg+xml", SVG));
});

/** A read of an object URL that the test finishes when it chooses. */
function heldRead(blob: Blob) {
    let finish = () => {};
    const held = new Promise<Response>((resolve) => { finish = () => resolve({ blob: async () => blob } as Response); });
    fetchMock.mockImplementationOnce(() => held);
    return () => finish();
}

it("leaves an image alone when its source changed while the bytes of the old one were read", async () => {
    const { host } = mount();
    const finish = heldRead(new Blob([SVG], { type: "image/svg+xml" }));
    const img = addImage(host, "blob:http://app.test/replaced", new Blob([SVG], { type: "image/svg+xml" }));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    img.setAttribute("src", "https://app.test/other.png");
    finish();
    await settle();
    expect(img.getAttribute("src")).toBe("https://app.test/other.png");
});

it("applies nothing to an image when the viewer is gone before a read in progress ends", async () => {
    const { host, unmount } = mount();
    const finish = heldRead(new Blob([SVG], { type: "image/svg+xml" }));
    const img = addImage(host, "blob:http://app.test/late", new Blob([SVG], { type: "image/svg+xml" }));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
    finish();
    await settle();
    expect(img.getAttribute("src")).toBe("blob:http://app.test/late");
});
