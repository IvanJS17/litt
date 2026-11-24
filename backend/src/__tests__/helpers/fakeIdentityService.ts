// A small stand-in for the identity service rules the invitation mail depends
// on, as observed on the real service: addresses are stored lowercase; sign-up
// never touches an existing unconfirmed identity; an invitation sends a link,
// gives a new identity no password, never changes an existing password, and
// replaces the previous link; changing a password through the admin API makes
// the pending link useless; a confirmed address cannot be invited; opening a
// link confirms the address, and the person then chooses a password. The admin
// lookup answers like `GET /auth/v1/admin/users?filter=...` (substring match).

export type Identity = {
  id: string;
  password: string | null;
  confirmed: boolean;
  invitedAt: string | null;
  createdAt: string;
  token: string | null;
  /** Set when the person has ever signed in. */
  lastSignInAt?: string | null;
};

type Tables = Record<string, Record<string, unknown>[]>;

export function fakeIdentityService() {
  const identities = new Map<string, Identity>();
  // As the database trigger does for every new identity: its own personal
  // organization and an `owner` row in it. Applies once `attachTables` names
  // the tables of the test's database.
  let tablesOf: (() => Tables) | null = null;
  const givePersonalOrg = (id: string) => {
    const tables = tablesOf?.();
    if (!tables) return;
    const orgId = `personal-${id}`;
    (tables.organizations ??= []).push({ id: orgId, name: "Personal", kind: "personal", personal_user_id: id });
    (tables.org_members ??= []).push({ id: `owner-row-${id}`, org_id: orgId, user_id: id, role: "owner" });
  };
  const mails: Array<{ email: string; token: string }> = [];
  const nowIso = () => new Date().toISOString();
  let counter = 0;
  const publicUser = (email: string, u: Identity) => ({
    id: u.id,
    email,
    created_at: u.createdAt,
    invited_at: u.invitedAt,
    last_sign_in_at: u.lastSignInAt ?? null,
    email_confirmed_at: u.confirmed ? nowIso() : null,
  });
  const byId = (id: string) => [...identities.entries()].find(([, u]) => u.id === id);

  return {
    identities,
    mails,
    attachTables(getTables: () => Tables) {
      tablesOf = getTables;
    },
    reset() {
      identities.clear();
      mails.length = 0;
    },
    /** An identity that already exists (for instance one made by an earlier sign-up). */
    seed(email: string, partial: Partial<Identity> = {}) {
      const id = `id-${++counter}`;
      identities.set(email, {
        id,
        password: null,
        confirmed: false,
        invitedAt: null,
        createdAt: "2020-01-01T00:00:00.000Z",
        token: null,
        ...partial,
      });
      givePersonalOrg(identities.get(email)!.id);
    },
    minutesAgo(email: string, minutes: number) {
      identities.get(email)!.invitedAt = new Date(Date.now() - minutes * 60_000).toISOString();
    },
    signUp(email: string, password: string) {
      if (!identities.has(email)) {
        identities.set(email, { id: `id-${++counter}`, password, confirmed: false, invitedAt: null, createdAt: nowIso(), token: null });
        givePersonalOrg(identities.get(email)!.id);
      }
      return { data: { user: publicUser(email, identities.get(email)!), session: null }, error: null };
    },
    async invite(rawEmail: string) {
      const email = rawEmail.toLowerCase();
      const known = identities.get(email);
      if (known?.confirmed) return { data: {}, error: { code: "email_exists", message: "registered" } };
      const u = known ?? { id: `id-${++counter}`, password: null, confirmed: false, invitedAt: null, createdAt: nowIso(), token: null };
      // As on the real service: every invitation, a repeat included, sets the invitation date to now.
      u.invitedAt = nowIso();
      u.token = `token-${++counter}`;
      if (!known) givePersonalOrg(u.id);
      identities.set(email, u);
      mails.push({ email, token: u.token });
      return { data: { user: publicUser(email, u) }, error: null };
    },
    async deleteUser(id: string) {
      const found = byId(id);
      if (found) identities.delete(found[0]);
      return { data: {}, error: null };
    },
    async updateUserById(id: string, attrs: { password?: string }) {
      const found = byId(id);
      if (found && attrs.password) {
        found[1].password = attrs.password;
        found[1].token = null;
      }
      return { data: {}, error: null };
    },
    /** The person opens a mailed link (the newest one unless a token is given). True when it still works. */
    openLink(email: string, token?: string) {
      const u = identities.get(email)!;
      const wanted = token ?? mails.filter((m) => m.email === email).at(-1)?.token;
      if (!wanted || u.token !== wanted) return false;
      u.confirmed = true;
      return true;
    },
    choosePassword(email: string, password: string) {
      identities.get(email)!.password = password;
    },
    canSignIn(email: string, password: string) {
      const u = identities.get(email);
      return !!u && u.confirmed && u.password === password;
    },
    /** `fetch` for the admin lookup. */
    fetch: async (input: unknown) => {
      const url = new URL(String(input));
      const filter = url.searchParams.get("filter") ?? "";
      const users = [...identities.entries()].filter(([email]) => email.includes(filter)).map(([email, u]) => publicUser(email, u));
      const perPage = Number(url.searchParams.get("per_page") ?? 50);
      const page = Number(url.searchParams.get("page") ?? 1);
      return new Response(JSON.stringify({ users: users.slice((page - 1) * perPage, page * perPage) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
}
