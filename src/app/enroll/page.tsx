"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ArrayComponent from "@/components/ArrayComponent";
import { ArrayTag, VERIFICATION_BUREAUS } from "@/lib/array";
import { ArrayEvent, useArrayEvents } from "@/lib/useArrayEvents";
import { createClient } from "@/lib/supabase/client";

export default function EnrollPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace("/login");
        return;
      }
      setUserId(data.user.id);
    });
  }, [router]);

  useArrayEvents(async (detail) => {
    if (detail.tagName !== ArrayTag.accountEnroll && detail.tagName !== ArrayTag.authenticationKba) {
      return;
    }

    if (detail.event === ArrayEvent.signup) {
      // metadata carries userId, userToken and loginDelay. The token is not
      // sent to our backend — it stays in the browser and we mint our own.
      const enrolledId = detail.metadata?.userId as string | undefined;

      await fetch("/api/array/enrolled", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: enrolledId }),
      });

      router.push("/dashboard");
    }

    if (detail.event === ArrayEvent.failure) {
      setFailures((n) => n + 1);
    }
  });

  if (!userId) {
    return (
      <main className="shell shell--narrow">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="shell shell--narrow">
      <header className="page-head">
        <p className="eyebrow">Step 2 of 2</p>
        <h1>Verify your identity</h1>
        <p className="lede">
          The credit bureau needs to confirm you are who you say you are before it will
          release your report. You&rsquo;ll be asked for your Social Security number and a
          few questions only you would know the answer to.
        </p>
      </header>

      {failures >= 2 && (
        <p className="notice notice--warning" role="alert">
          Two attempts haven&rsquo;t matched. After four, the bureau locks the report for up
          to 30 days and we can&rsquo;t override it. If the questions are about accounts you
          don&rsquo;t recognise, stop here and call us on {"{support number}"} instead.
        </p>
      )}

      {/*
        Attributes worth noting:

        userId  — our own Supabase user id, so Array's record and ours share a
                  primary key and no reconciliation step is needed. Fits Array's
                  36-character limit exactly.

        uponSuccessShow — deliberately NOT set to "quickView". That value
                  suppresses the signup event, which is the only place the
                  userId and userToken are handed back.

        tui/exp/efx — all-or-none. See VERIFICATION_BUREAUS in lib/array.ts for
                  the open question about which the contract actually covers.
      */}
      <ArrayComponent
        className="array-host"
        tag={ArrayTag.accountEnroll}
        attributes={{
          userId,
          showSplash: "false",
          showEmailPasswordFields: "false",
          dobAsText: "true",
          uponSuccessShow: "successMessage",
          termsOfUseHref: "/terms",
          privacyPolicyHref: "/privacy",
          ...VERIFICATION_BUREAUS,
        }}
      />
    </main>
  );
}
