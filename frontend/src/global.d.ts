declare module "*.css";

// Typecheck also runs before Next generates next-env.d.ts on a fresh checkout.
// SVG imports use Next's static asset loader, not an SVG-to-component transform.
declare module "*.svg" {
    const asset: import("next/image").StaticImageData;
    export default asset;
}

// Font files imported for their built URL (see layout.tsx).
declare module "*.woff2" {
    const url: string;
    export default url;
}
