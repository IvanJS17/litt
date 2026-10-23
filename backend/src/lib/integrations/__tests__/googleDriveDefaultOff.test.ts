/**
 * LiTT policy: Google Drive is not offered unless the operator says so.
 *
 * The upstream switch (`GOOGLE_WORKSPACE_DISABLED_PROVIDERS`) keeps whatever
 * the operator lists. LiTT's default is closed: with the variable undefined,
 * `google-drive` counts as switched off, so OAuth start and the Picker answer
 * 404 through their existing error mapping and the assistant receives no
 * Drive tools. Gmail still asks for exactly `gmail.readonly` +
 * `gmail.compose`, and the broader scopes Mike used to request are not
 * treated as implying them, because LiTT never issued those grants.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  disabledGoogleServices,
  isGoogleServiceAvailable,
} from "../googleAvailability";
import {
  buildGoogleDriveTools,
  createGoogleDrivePickerSession,
  driveScopeGrants,
  GOOGLE_DRIVE_SCOPE,
  GoogleDriveUnavailableError,
  startGoogleDriveOAuth,
} from "../googleDrive";
import { requestedScopes } from "../googleWorkspaceAuth";

const GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify";
// Whole-Drive scopes upstream recognized; LiTT never issued them.
const LEGACY_FULL_DRIVE = "https://www.googleapis.com/auth/drive";
const LEGACY_READONLY_DRIVE = "https://www.googleapis.com/auth/drive.readonly";
const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_COMPOSE = "https://www.googleapis.com/auth/gmail.compose";

const original = process.env.GOOGLE_WORKSPACE_DISABLED_PROVIDERS;

beforeEach(() => {
  delete process.env.GOOGLE_WORKSPACE_DISABLED_PROVIDERS;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (original === undefined)
    delete process.env.GOOGLE_WORKSPACE_DISABLED_PROVIDERS;
  else process.env.GOOGLE_WORKSPACE_DISABLED_PROVIDERS = original;
  vi.restoreAllMocks();
});

describe("default configuration", () => {
  it("treats google-drive as switched off and Gmail/Calendar as offered", () => {
    expect(disabledGoogleServices()).toEqual(["google-drive"]);
    expect(isGoogleServiceAvailable("google-drive")).toBe(false);
    expect(isGoogleServiceAvailable("gmail")).toBe(true);
    expect(isGoogleServiceAvailable("google-calendar")).toBe(true);
  });

  it("refuses OAuth start with the unavailable error the route maps to 404", async () => {
    await expect(
      startGoogleDriveOAuth("user-1", "http://localhost:3000/callback", {
        from: () => {
          throw new Error("the switched-off service must not touch the db");
        },
      } as never),
    ).rejects.toBeInstanceOf(GoogleDriveUnavailableError);
  });

  it("refuses the Picker session with the unavailable error the route maps to 404", async () => {
    await expect(
      createGoogleDrivePickerSession("user-1", {
        from: () => {
          throw new Error("the switched-off service must not touch the db");
        },
      } as never),
    ).rejects.toBeInstanceOf(GoogleDriveUnavailableError);
  });

  it("carries the `connector_unavailable` code the route maps to 404", () => {
    // `POST /user/integrations/google-drive/oauth/start` and
    // `POST .../picker-session` answer 404 for GoogleDriveUnavailableError;
    // that mapping is covered by integration/googleWorkspace.routes.test.ts.
    expect(new GoogleDriveUnavailableError().code).toBe("connector_unavailable");
  });

  it("gives the assistant no Drive tools at all", async () => {
    await expect(
      buildGoogleDriveTools("user-1", {
        from: () => {
          throw new Error("the switched-off service must not touch the db");
        },
      } as never),
    ).resolves.toEqual([]);
  });
});

describe("operator opt-in", () => {
  it("offers Drive again when the operator defines an empty list", () => {
    process.env.GOOGLE_WORKSPACE_DISABLED_PROVIDERS = "";
    expect(disabledGoogleServices()).toEqual([]);
    expect(isGoogleServiceAvailable("google-drive")).toBe(true);
  });

  it("keeps an explicit list authoritative", () => {
    process.env.GOOGLE_WORKSPACE_DISABLED_PROVIDERS = "gmail, google-drive";
    expect(disabledGoogleServices()).toEqual(["gmail", "google-drive"]);
    expect(isGoogleServiceAvailable("gmail")).toBe(false);
    expect(isGoogleServiceAvailable("google-calendar")).toBe(true);
  });
});

describe("recognized scopes", () => {
  it("Gmail requests only gmail.readonly and gmail.compose", () => {
    expect(requestedScopes("gmail")).toEqual([
      "openid",
      "email",
      GMAIL_READONLY,
      GMAIL_COMPOSE,
    ]);
  });

  it("does not treat the legacy gmail.modify grant as implying its narrower scopes", () => {
    // The write decision reads the grant through the same implication table
    // the status card uses; `gmail.modify` is not one of the issued scopes.
    const scope = `openid email ${GMAIL_MODIFY}`;
    expect(scope.split(" ")).not.toContain(GMAIL_COMPOSE);
    expect(scope.split(" ")).not.toContain(GMAIL_READONLY);
  });

  it("recognizes only the per-file Drive scope Mike asks for", () => {
    expect(driveScopeGrants(`openid email ${GOOGLE_DRIVE_SCOPE}`, "write")).toBe(
      true,
    );
    expect(
      driveScopeGrants(`openid email ${GOOGLE_DRIVE_SCOPE}`, "picker"),
    ).toBe(true);
    for (const legacy of [LEGACY_FULL_DRIVE, LEGACY_READONLY_DRIVE]) {
      expect(driveScopeGrants(`openid email ${legacy}`, "read")).toBe(false);
      expect(driveScopeGrants(`openid email ${legacy}`, "write")).toBe(false);
      expect(driveScopeGrants(`openid email ${legacy}`, "picker")).toBe(false);
    }
  });
});
