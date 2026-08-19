/**
 * Placeholder. Linked from array-account-enroll via privacyPolicyHref.
 *
 * Worth writing accurately rather than boilerplating: this app genuinely does
 * not store SSNs, dates of birth or report contents — those go from the
 * customer's browser to Array directly. That is a real claim the policy can
 * make, and the schema is what backs it up.
 */
export default function PrivacyPage() {
  return (
    <main className="shell shell--narrow prose">
      <header className="page-head">
        <h1>Privacy</h1>
      </header>
      <p className="notice notice--warning">
        Placeholder. Awaiting copy from the firm before launch.
      </p>
    </main>
  );
}
