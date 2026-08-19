# Build status — Array credit monitoring

Client: **Mistake Law PC** (Array Client ID 3107)
Array contact: Tim Cheng, deployment engineer
Environment: Array **sandbox** only. Nothing has touched live bureau data.

---

## The decision everything else follows from

Array's web components run in the browser and talk to Array directly. **Credit
report data, bureau responses, and the customer's SSN never pass through this
application.**

Array's REST API offers a *Create a User* endpoint that would accept SSN and
date of birth from our backend. It is deliberately unused. Taking that path
would pull back the compliance exposure Array otherwise absorbs.

Exactly one server-to-Array call exists: token regeneration in
`src/app/api/array/token/route.ts`. Everything else is browser-to-Array.

> If a change would put an SSN, a date of birth, or report contents into this
> database, that change is wrong.

```
Browser                          This app                    Array
───────                          ────────                    ─────
signup form ──────────────────▶  Supabase auth
enrol component ─────────────────────────────────────────▶  PII, verification
   │ signup event
   └──────────────────────────▶  record enrolment (RPC)
dashboard  ◀── userToken ──────  POST /api/array/token ───▶  regenerate token
report component ────────────────────────────────────────▶  order + render
```

---

## What exists now

### Application

A Next.js 15 app (App Router, React 19, TypeScript strict), assembled from a
set of loose source files into a running project.

| Area | Files |
|---|---|
| Pages | `login`, `enroll`, `dashboard`, `terms`, `privacy`, root router |
| Array integration | `components/ArrayComponent.tsx`, `lib/array.ts`, `lib/useArrayEvents.ts`, `lib/useArrayToken.ts` |
| API routes | `api/array/token`, `api/array/enrolled`, `api/array/audit` |
| Supabase | `lib/supabase/client.ts`, `lib/supabase/server.ts`, `middleware.ts` |
| Database | `supabase/schema.sql`, `supabase/002_security_lockdown.sql` |
| Styling | `app/globals.css` (MISTAKE brand), `app/layout.tsx` |

Accounts are ours, in Supabase — not `array-account-login`. Using Array's login
would give customers two separate logins for one product.

Array `userId` **is** the Supabase user id. A UUID fits Array's 36-character
limit exactly, so the mapping between their record and ours is just the primary
key. No reconciliation step exists because none is needed.

### Branding

Applied from the MISTAKE brand spec: ClashDisplay 600 headings (Fontshare),
Inter body (self-hosted via `next/font`), `#FF5400` primary, `#113B4E` text,
`#FFE9D6` warm accent, `#001D26` dark ground.

Two deviations, both deliberate and marked in the CSS:

- **`#9C9C9C` is used for borders only.** As text on white it measures 2.75:1,
  below the WCAG AA floor of 4.5:1. Secondary text uses `#4A6675`, a tint
  derived from the brand navy, at 6.09:1.
- **Orange headings never sit on cream.** That pairing is 2.74:1.

**Open, and a decision for the firm:** white text on `#FF5400` buttons measures
**3.22:1** — it fails WCAG AA for normal-size text. This is inherent to the
brand orange, not fixable by tweaking. Options are darker button text, a darker
orange for text-bearing surfaces, or navy buttons with orange as accent. Built
as specified pending that call.

### Database

Two tables, no PII by design:

- `profiles` — id, full_name, `array_user_id`, `enrolled_at`
- `array_events` — insert-only audit trail, since billing is per pull

No SSN. No date of birth. No report contents.

---

## Security work

An audit raised eight findings. Three were rated high; two of those were real
and are fixed, one was misclassified.

### Fixed

**Enrolment mapping could be pointed at another customer.** The original
`profiles: update own` policy allowed updating any column on your own row,
including `array_user_id`. Setting it to another customer's UUID would have
made `/api/array/token` mint an Array `userToken` for their credit file. What
prevented it was the `unique` index on that column — an index added for data
hygiene, doing authorisation work by accident, and not covering customers who
had signed up without enrolling.

Fixed by column-level grants (RLS cannot restrict columns) plus
`record_array_enrolment()`, a `SECURITY DEFINER` function that sets
`array_user_id` from `auth.uid()` **as a non-parameter**. There is no argument a
caller can pass to point the mapping elsewhere. The vulnerability class is gone
rather than checked for.

**The browser could write unredacted audit rows.** `array_events: insert own`
let a signed-in user insert arbitrary JSON directly, bypassing redaction — which
breaks the one guarantee the schema exists to make. The policy and privilege are
both dropped; `record_array_event()` is now the only path in, and it redacts in
SQL before inserting.

**Redaction skipped arrays.** `{ events: [{ userToken: "…" }] }` passed through
untouched — the denylist only ever saw the key `events`. Both the TypeScript and
SQL redactors now recurse arrays and objects, with a depth cap.

### Also done

- Rate limiting on `/api/array/token` (10 per 10 min, per user, after auth)
- Body size caps on both write routes; 8KB metadata ceiling in the database
- Middleware redirects `/enroll` and `/dashboard` to `/login` when unauthenticated
- Security headers: `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, `COOP`, `nosniff`

### Deliberately not done

**No Content-Security-Policy beyond `frame-ancestors`.** Array's bundles are
250–500KB of third-party code that mount custom elements and inject their own
styles. A policy written without observing what they actually request would
either break the credit report or be permissive enough to prove nothing. The
route in is `Content-Security-Policy-Report-Only` while driving a real enrolment
and report render — which needs the Array server token first.

**Enrolment is not verified against Array.** `/api/array/enrolled` currently
trusts that the browser's `signup` event means what it says. A false flag grants
no access — the token mint fails immediately — so this is state corruption, not
an access path. Verifying properly needs the server API, hence the same blocker.

### Outstanding for production

- **Rotate the Array Client Token and Supabase secret key.** Both travelled by
  plaintext email and chat. The Array AppKey is public by design and does not
  need rotating for secrecy, though it is worth rotating alongside.
- **`git init`.** The repo isn't under version control yet, so `.gitignore` is
  currently inert and `.env.local` holds a live token.
- **Rate limiting needs a shared store** (Upstash / Vercel KV). The current
  implementation is in-memory and therefore per-instance on serverless.
- **Password policy** and real terms/privacy copy.

---

## Verified

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `/` unauthenticated | 307 → `/login` |
| `/enroll`, `/dashboard` unauthenticated | 307 → `/login` |
| `/api/array/*` unauthenticated | 401 |
| Security headers | present on all routes |
| Redaction unit tests | 6/6 pass, including the array case |
| Rate limiter | allows exactly 10 of 12 |
| Array sandbox scripts + AppKey | 200 for enroll, report, debt-analysis |
| Migration applied | both RPCs exist; direct table writes return 42501 |

**Not yet exercised:** the enrolment flow end to end, and anything past it. That
is gated on the server token below.

---

## Blocked on Array — for Tim

1. **Server token.** `x-array-server-token` is required by the regeneration
   endpoint. Array sent Client ID, AppKey and Client Token. Is the Client Token
   that header's value, or is a fourth credential outstanding? Without it,
   `/api/array/token` returns 502 and the dashboard cannot load. *This is the
   single blocker gating the most work.*

2. **Product codes.** Enabled: `tui3bReportScore`, `tui3bStandardMonitoring`,
   `authenticate`. The dashboard renders four views, and two of them —
   Score Insights and Debt Analysis — have no matching enabled code. The scope
   also lists Score Tracker. Confirm coverage, or half the dashboard fails.

3. **Production API host.** Only `sandbox.array.io` is documented.

4. **IP allowlisting.** If Array allowlists inbound API callers, plain Vercel
   won't work — serverless functions have no static outbound IP. Options: a
   static-IP proxy, hosting the one API route elsewhere, or Vercel Secure
   Compute. Only one call needs it, so this is cheap to solve once known.
   A home IP was sent to Array; confirm what that was actually for.

5. **Bureau configuration.** Scope says TransUnion 3B and every product code is
   `tui3b*`, but the components default to all three with fallthrough
   (TransUnion OTP → Experian KBA → Equifax SMFA). The attributes are
   all-or-none. TU-only matches the contract but means a customer TransUnion
   can't verify simply fails.

6. **Billable events.** What exactly counts as a pull? The audit hook currently
   guesses at the report component's `loaded` event.

7. **Webhooks.** Marked optional by Array. Reports arrive through components, so
   the likely use is monitoring alerts. Confirm before building an endpoint.

---

## Unresolved product question

Whether this is customer-facing or internal to the firm is still open.

If staff are meant to pull reports on behalf of clients, **that does not work** —
not because of this code, but because TransUnion sends the OTP to the consumer's
phone and Experian's questions are about the consumer's own history. A staff
member cannot complete verification for someone else.

Workable shapes: client self-serve via a link, or staff walking the client
through it while the client is on the phone. A third — staff create the account
and email the client a link to finish verification — needs one extra screen,
roughly a day.

There is also an FCRA permissible-purpose question if the firm pulls reports for
clients. Consumer attorneys are on the email thread and will know what applies.

---

## Running it

```bash
npm install
npm run dev
```

`.env.local` holds Supabase and Array sandbox values. `ARRAY_SERVER_TOKEN`
contains the Client Token as an unconfirmed guess — see blocker 1.

Apply `supabase/schema.sql` then `supabase/002_security_lockdown.sql`. Both are
already applied to the current project.

For sandbox testing, turn off **Confirm email** in Supabase Auth. TransUnion
sandbox identities use OTP `12345`; Thomas Friedman is TU-only and matches the
bureau configuration:

```
SSN 666234390 · DOB 1975-01-01 · 535 30 RD A, Grand Junction CO 81504
```

### Gotchas that cost an afternoon each

- `uponSuccessShow="quickView"` suppresses the `signup` event — the only place
  Array returns the userId after enrolment. The enrol page sets
  `successMessage` instead.
- Boolean attributes must be the literal string `"true"`. A bare attribute name
  reads as false.
- `logout` fires on 401/403, not just on logout. The dashboard tries a silent
  refresh first.
- Tokens expire after 60 **idle** minutes. Each interaction resets the clock.
- **Four failed TransUnion attempts locks the report for up to 30 days.** No
  override exists. The enrol page warns after two.
- `@import` in `globals.css` is silently discarded — `next/font` injects its
  `@font-face` rules first, pushing the import past the first rule. Fonts must
  be loaded via `<link>` in `layout.tsx`.
