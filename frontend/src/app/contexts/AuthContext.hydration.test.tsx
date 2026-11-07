import { Suspense, lazy } from "react";
import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

const session = vi.hoisted(() => ({
    resolve: null as null | ((user: unknown) => void),
}));
vi.mock("@/app/lib/authApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/authApi")>()),
    getAuthSession: () =>
        new Promise((resolve) => {
            session.resolve = resolve;
        }),
}));

function SessionState() {
    const { authLoading, isAuthenticated } = useAuth();
    if (authLoading) return <p>Loading</p>;
    return <h1>{isAuthenticated ? "Signed in" : "Check your email"}</h1>;
}

afterEach(() => {
    document.body.innerHTML = "";
});

// /signup/check-email: the page's boundary hydrated after the session
// request had already answered, so its first client render showed the
// signed-out heading where the server had rendered the loader.
it("hydrates a late boundary with the server's loading state, then shows the session", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(
        <AuthProvider>
            <Suspense fallback={null}>
                <SessionState />
            </Suspense>
        </AuthProvider>,
    );
    expect(container).toHaveTextContent("Loading");
    document.body.append(container);

    let loadPage!: () => void;
    const LatePage = lazy(
        () =>
            new Promise<{ default: typeof SessionState }>((resolve) => {
                loadPage = () => resolve({ default: SessionState });
            }),
    );
    const recoverableError = vi.fn();
    let root!: ReturnType<typeof hydrateRoot>;
    try {
        await act(async () => {
            root = hydrateRoot(
                container,
                <AuthProvider>
                    <Suspense fallback={null}>
                        <LatePage />
                    </Suspense>
                </AuthProvider>,
                { onRecoverableError: recoverableError },
            );
        });
        // The session answers (signed out) before the page's code arrives.
        await act(async () => session.resolve?.(null));
        await act(async () => loadPage());

        expect(recoverableError).not.toHaveBeenCalled();
        expect(container).toHaveTextContent("Check your email");
    } finally {
        await act(async () => root?.unmount());
    }
});
