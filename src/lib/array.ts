/**
 * Array configuration.
 *
 * Two environments, switched by NEXT_PUBLIC_ARRAY_SANDBOX:
 *
 *   sandbox -> embed.sandbox.array.io, Array's fictitious test identities,
 *              verification is not a billable event
 *   live    -> embed.array.io, real bureau data, real per-pull billing
 */

export const ARRAY_APP_KEY = process.env.NEXT_PUBLIC_ARRAY_APP_KEY ?? "";

export const ARRAY_SANDBOX = process.env.NEXT_PUBLIC_ARRAY_SANDBOX === "true";

export const ARRAY_EMBED_BASE = ARRAY_SANDBOX
  ? "https://embed.sandbox.array.io"
  : "https://embed.array.io";

/**
 * REST host the widgets call. Distinct from the embed script host.
 * Array's own snippet sets this as apiUrl on the custom element.
 * Derived from NEXT_PUBLIC_ARRAY_SANDBOX so it stays off the server-only
 * ARRAY_API_BASE variable. Override with NEXT_PUBLIC_ARRAY_API_BASE if the
 * two ever need to differ.
 */
export const ARRAY_API_URL =
  process.env.NEXT_PUBLIC_ARRAY_API_BASE ||
  (ARRAY_SANDBOX ? "https://sandbox.array.io" : "https://array.io");

/**
 * Array component tag names.
 *
 * Only the ones in scope for this build. The full list is much longer —
 * see Array's "Web Components and Attributes" reference.
 */
export const ArrayTag = {
  accountEnroll: "array-account-enroll",
  accountLogin: "array-account-login",
  accountSettings: "array-account-settings",
  authenticationKba: "array-authentication-kba",
  creditOverview: "array-credit-overview",
  creditReport: "array-credit-report",
  creditScore: "array-credit-score",
  creditScoreInsights: "array-credit-score-insights",
  creditDebtAnalysis: "array-credit-debt-analysis",
  creditAlerts: "array-credit-alerts",
} as const;

export type ArrayTagName = (typeof ArrayTag)[keyof typeof ArrayTag];

/**
 * Bureau selection.
 *
 * The kickoff scope says TransUnion 3B / Vantage 3.0, and every enabled
 * product code is tui3b*. But Array's enroll and KBA components default all
 * three bureaus to true and fall through in a fixed order when one doesn't
 * recognise the customer: TransUnion (OTP) -> Experian (KBA) -> Equifax (SMFA).
 *
 * The attributes are all-or-none, so this is a single decision:
 *
 *   TU only     -> matches the contracted scope exactly, but a customer
 *                  TransUnion can't verify simply fails
 *   All three   -> better verification success rate, softens the TransUnion
 *                  lockout problem, but may exceed what's contracted
 *
 * TODO: confirm with Array which is intended. Set here once, not per-page.
 */
const BUREAUS_ALL = { tui: "true", exp: "true", efx: "true" } as const;
const BUREAUS_TU_ONLY = { tui: "true", exp: "false", efx: "false" } as const;

/**
 * Set NEXT_PUBLIC_ARRAY_BUREAUS to "all" to enable all three, anything else
 * (or unset) keeps TransUnion only.
 *
 * Env-driven because this is a live operational decision, not a code one:
 * TU-only matches the contracted scope, but any consumer TransUnion cannot
 * recognise fails outright with nothing to fall through to — including most
 * of Array's sandbox identities, which require every bureau they list to be
 * passed as a verification provider. Flipping this needs to be a one-minute
 * change during a support call, not a deploy.
 */
export const VERIFICATION_BUREAUS =
  process.env.NEXT_PUBLIC_ARRAY_BUREAUS === "all" ? BUREAUS_ALL : BUREAUS_TU_ONLY;

/**
 * Array caps userToken lifetime at 60 minutes. The clock is idle-based —
 * each customer interaction with a component refreshes it.
 */
export const TOKEN_TTL_MINUTES = 60;

/**
 * Refresh a little before the token actually dies, so an in-flight component
 * call doesn't land on an expired token.
 */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
