import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { upstreamUnreachableCode } from "./upstreamFailure";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function backendOrigin() {
    const configuredUrl = process.env.API_BASE_URL?.trim();
    if (!configuredUrl && process.env.NODE_ENV === "production") {
        throw new Error("API_BASE_URL is required at runtime.");
    }

    const backendUrl = new URL(configuredUrl || "http://localhost:3001");
    if (!["http:", "https:"].includes(backendUrl.protocol)) {
        throw new Error("API_BASE_URL must use http or https.");
    }
    return backendUrl.toString().replace(/\/$/, "");
}

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: RouteContext) {
    const { path } = await context.params;
    const requestPath = `/${path.map(encodeURIComponent).join("/")}`;

    const requestId = randomUUID();
    let stage = "gateway-config";
    try {
        const upstreamUrl = new URL(`${backendOrigin()}${requestPath}`);
        upstreamUrl.search = request.nextUrl.search;

        const headers = new Headers(request.headers);
        headers.delete("host");
        headers.delete("connection");
        headers.delete("content-length");
        headers.set("x-forwarded-host", request.nextUrl.host);
        headers.set(
            "x-forwarded-proto",
            request.nextUrl.protocol.replace(":", ""),
        );

        const init: RequestInit & { duplex?: "half" } = {
            method: request.method,
            headers,
            cache: "no-store",
            redirect: "manual",
        };
        if (request.method !== "GET" && request.method !== "HEAD") {
            init.body = request.body;
            init.duplex = "half";
        }

        stage = "gateway-fetch";
        const upstream = await fetch(upstreamUrl, init);
        stage = "gateway-response";
        const responseHeaders = new Headers(upstream.headers);
        // Fetch implementations may transparently decompress the response.
        responseHeaders.delete("content-encoding");
        responseHeaders.delete("content-length");

        return new Response(upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: responseHeaders,
        });
    } catch (error) {
        // A connection-level failure (ECONNREFUSED, DNS, reset, connect
        // timeout) means the backend is down or misaddressed: an operator
        // condition the user can only wait out, so it answers 503 with a
        // stable code and Retry-After. Anything else is a 502.
        const unreachable =
            stage === "gateway-fetch" ? upstreamUnreachableCode(error) : null;
        const status = unreachable ? 503 : 502;
        // The operator's own server log keeps the real cause (ECONNREFUSED,
        // DNS, TLS): without it a self-hoster seeing 502s cannot tell a
        // stopped backend from a wrong API_BASE_URL.
        console.error("[api-gateway] upstream request failed", error, { requestId, stage });
        return Response.json(
            {
                detail: "The API is temporarily unavailable.",
                ...(unreachable ? { code: "upstream_unavailable" } : {}),
                request_id: requestId,
            },
            {
                status,
                headers: {
                    "x-request-id": requestId,
                    ...(unreachable ? { "retry-after": "5" } : {}),
                },
            },
        );
    }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
