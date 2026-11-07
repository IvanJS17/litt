// Every component test renders under the app's intl provider in en-US, the
// source catalog, so existing English assertions keep passing as screens move
// to next-intl (plan i18n R2). vitest.setup.ts swaps these in for Testing
// Library's render and renderHook; a test that needs es-MX wraps its own
// <IntlClientProvider locale="es-MX" ...> inside, and the inner one wins.
import type * as RTL from "@testing-library/react";
import { isValidElement, StrictMode, type ComponentType, type ReactElement, type ReactNode } from "react";
import enUS from "../../../../packages/i18n/messages/en-US.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";

type Wrapper = ComponentType<{ children: ReactNode }>;
type Options = { wrapper?: unknown; reactStrictMode?: boolean };

function withIntl(Inner?: Wrapper): Wrapper {
    return function IntlTestWrapper({ children }) {
        return (
            <IntlClientProvider locale="en-US" messages={enUS}>
                {Inner ? <Inner>{children}</Inner> : children}
            </IntlClientProvider>
        );
    };
}

// React 19 replays mount effects only when StrictMode is the root, so a
// provider above a test's <StrictMode> (or `wrapper: StrictMode`) would turn
// the replay off. Lift it to Testing Library's root-level option instead.
const isStrict = (ui: unknown): ui is ReactElement<{ children?: ReactNode }> =>
    isValidElement(ui) && ui.type === StrictMode;
const unwrap = (ui: ReactNode) => (isStrict(ui) ? ui.props.children : ui);

function intlOptions<O extends Options>(options: O | undefined, strictUi: boolean): O {
    const strictWrapper = options?.wrapper === StrictMode;
    return {
        ...options,
        reactStrictMode: strictUi || strictWrapper || options?.reactStrictMode,
        wrapper: withIntl(strictWrapper ? undefined : (options?.wrapper as Wrapper | undefined)),
    } as O;
}

export function intlRenderers(rtl: typeof RTL) {
    const render = ((ui: ReactNode, options?: RTL.RenderOptions) => {
        const result = rtl.render(unwrap(ui), intlOptions(options, isStrict(ui)));
        const rerender = result.rerender;
        // The root is already strict; keep the tree shape so nothing remounts.
        result.rerender = (next: ReactNode) => rerender(unwrap(next));
        return result;
    }) as unknown as typeof RTL.render;
    const renderHook = ((hook: (props: unknown) => unknown, options?: RTL.RenderHookOptions<unknown>) =>
        rtl.renderHook(hook, intlOptions(options, false))) as typeof RTL.renderHook;
    return { render, renderHook };
}
