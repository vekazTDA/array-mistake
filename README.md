# Credit monitoring — Array integration

Next.js app that embeds Array's web components for TransUnion credit reports,
scores, insights and debt analysis.

## The shape of it

Array's components run in the browser and talk to Array directly. Credit
report data, bureau responses, and the customer's SSN never pass through this
application. That is the main architectural decision here, and most of the
rest follows from it.

What this app is actually responsible for:

1. Accounts — email and password, in Supabase. Ours, not Array's.
2. Enrolment — hosting `array-account-enroll`, and recording that it succeeded.
3. Tokens — minting Array `userToken`s server-side, because the server token
   can't be exposed to the browser.
4. Audit — a local record of report pulls, since billing is per pull.

```
Browser                          This app                    Array
───────                          ────────                    ─────
signup form ──────────────────▶  Supabase auth
enrol component ─────────────────────────────────────────▶  PII, verification
   │ signup event
   └──────────────────────────▶  record array_user_id
dashboard  ◀── userToken ──────  POST /api/array/token ───▶  regenerate token
report component ────────────────────────────────────────▶  order + render
```

## Running it

```bash
cp .env.example .env.local     # fill in the values
npm install
npm run dev
```

Then apply `supabase/schema.sql` to your Supabase project.

`NEXT_PUBLIC_ARRAY_SANDBOX=true` points everything at Array's sandbox, where
verification is free and the test identities are fictitious. Test personas are
in Array's sandbox identities doc — TransUnion ones use an OTP of `12345`.

Note that sandbox identities each support specific bureaus, and you must pass
every bureau listed for that identity as a verification provider. Thomas Devos
needs all three even if you only want the TransUnion report.

## Files worth reading first

| Path | Why |
|---|---|
| `src/components/ArrayComponent.tsx` | How components get mounted and kept alive across token refresh |
| `src/lib/useArrayEvents.ts` | The single `array-event` listener and what each event means |
| `src/app/api/array/token/route.ts` | The only server-side Array call |
| `src/lib/array.ts` | Configuration, and the bureau question |

## Things that will bite you

**`uponSuccessShow="quickView"` suppresses the signup event.** That event is
the only place Array hands back the `userId` and `userToken` after enrolment.
The enrol page deliberately sets `successMessage` instead.

**Boolean attributes must be the literal string `"true"`.** Adding the bare
attribute name does nothing at all — it reads as false.

**`logout` fires on 401/403, not just on logout.** An expired token surfaces
through the same event as a deliberate sign-out. The dashboard tries a silent
token refresh first rather than bouncing the customer to a login screen.

**Four failed TransUnion attempts locks the report for up to 30 days.** There
is no override. The enrol page warns after two, and support needs an answer
ready for people who hit the limit.

**Tokens die after 60 idle minutes.** Idle, not absolute — each interaction
resets the clock. The refresh timer fires five minutes early.

## Open questions

These block parts of the build and need answers from Array.

- **Server token.** The regeneration endpoint wants `x-array-server-token`.
  Array sent Client ID, AppKey and Client Token. Is the Client Token the same
  thing, or is a fourth credential outstanding?
- **Production API host.** Only `sandbox.array.io` is documented.
- **IP allowlisting.** If Array allowlists inbound API callers, plain Vercel
  won't work — serverless functions have no static outbound IP. Needs Secure
  Compute, a static-IP proxy, or hosting the API layer elsewhere. Decide in
  week one, not week three.
- **Bureau configuration.** Scope says TransUnion only and every product code
  is `tui3b*`, but the components default to all three with fallthrough. The
  attributes are all-or-none. Which is intended?
- **Product codes.** Enabled: `tui3bReportScore`, `tui3bStandardMonitoring`,
  `authenticate`. Scope also lists Debt Analysis, Score Insights and Score
  Tracker — confirm those are covered.
- **Billable events.** What exactly counts as a pull? The audit hook currently
  guesses at the report component's `loaded` event.
- **Webhooks.** Marked optional by Array. Reports arrive through the
  components, so the likely use is monitoring alerts. Confirm what events
  they'd send before building an endpoint.

## Credentials

Rotate the AppKey and Client Token that were sent over email before launch.

Everything server-side lives in Vercel environment variables, scoped per
environment. The Supabase service role key bypasses row level security
entirely — server-side only, never in a client component.
