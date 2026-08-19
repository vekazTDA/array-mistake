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
export const VERIFICATION_BUREAUS = {
  tui: "true",
  exp: "false",
  efx: "false",
} as const;

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
