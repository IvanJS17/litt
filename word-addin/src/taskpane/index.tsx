/// <reference types="office-js" />
import { createRoot } from "react-dom/client";
import App from "./App";
import { notifyError } from "./lib/notify";
import { ToastViewportUI } from "@mike/ui";
// Inter, Newsreader and Departure Mono, served from this add-in (no Google
// Fonts). Sets --font-inter, --font-newsreader and --font-departure-mono.
import "@litt/fonts/fonts.css";
import "./styles.css";
import { PaneErrorBoundary } from "./components/shell/PaneErrorBoundary";
import { PaneErrorFallback } from "./components/shell/PaneErrorFallback";
import { clientTranslator } from "@mike/client";
import { initialLocale } from "./i18n/locale";
import { LocaleProvider } from "./i18n/LocaleProvider";
import { loadLocale } from "./i18n/loadLocale";
import { OutsideOfficeNotice } from "./components/shell/OutsideOfficeNotice";

// A rejected promise nobody awaited used to vanish into the WebView console,
// which a user in Word cannot open. This is the user's side of it — one
// deduped toast, because one broken poll can reject on every tick.
window.addEventListener("unhandledrejection", (event) => {
  notifyError(event.reason, {
    action: clientTranslator()("word.notify.completeAction"),
    dedupeKey: "unhandled",
  });
});

// `@container` makes the whole pane a query container so descendants can
// adapt spacing/type to the (resizable, usually narrow) task-pane width via
// `@sm:`/`@md:` variants — viewport breakpoints never fire in a pane.
const PANE_CLASS =
  "@container h-full w-full bg-background text-foreground font-sans antialiased";

Office.onReady(async (info) => {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Root element #root not found in DOM");
  }
  const root = createRoot(container);
  // The pane's first paint is already in its language: the catalog loads
  // before React renders, from this device's choice or Word's own language.
  // The profile's choice replaces it once the session is known (App).
  const initial = await loadLocale(initialLocale()).catch(() =>
    // A catalog that cannot load must not leave the pane blank.
    loadLocale("en-US"),
  );
  // Office.js resolves onReady outside Office too, with no host. There is no
  // document to work on and no Office storage, so mounting the app there only
  // produced a broken pane (crawlers, link previews and pasted URLs open it).
  if (info.host == null) {
    root.render(
      <LocaleProvider initial={initial}>
        <div className={PANE_CLASS}>
          <OutsideOfficeNotice />
        </div>
      </LocaleProvider>,
    );
    return;
  }
  root.render(
    // `@container` makes the whole pane a query container so descendants can
    // adapt spacing/type to the (resizable, usually narrow) task-pane width
    // via `@sm:`/`@md:` variants — viewport breakpoints never fire in a pane.
    <LocaleProvider initial={initial}>
      <div className={PANE_CLASS}>
        <PaneErrorBoundary
          fallback={({ resetError }) => (
            <PaneErrorFallback resetError={resetError} />
          )}
        >
          <App />
        </PaneErrorBoundary>
        {/* Mounted beside App, not inside it: App returns early while the
            session loads and on the login screen, and a failure there still
            needs somewhere to appear. Outside the boundary so a render crash
            does not take the notifications with it. The pane is ~320px wide,
            so the shared viewport's 460px cap is tightened to fit. */}
        <ToastViewportUI
          className="w-full max-w-[min(96vw,380px)] px-2"
        />
      </div>
    </LocaleProvider>,
  );
});
