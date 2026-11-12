// Serves the round-trip harness. Mirrors docx-preview.vite.config.mjs so
// EigenPal's import.meta.url font and WASM assets resolve as in the app.
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
const root = fileURLToPath(new URL("./harness", import.meta.url));

const config = {
    root,
    define: { "process.env": "{}" },
    plugins: [react()],
    build: { target: "esnext" },
    server: { fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
    optimizeDeps: {
        exclude: ["@docx-editor.dev/fonts", "@docx-editor.dev/core", "@docx-editor.dev/react"],
        rolldownOptions: { transform: { target: "esnext" } },
    },
};

export default config;
