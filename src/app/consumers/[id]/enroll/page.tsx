"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ArrayComponent from "@/components/ArrayComponent";
import { ArrayTag, VERIFICATION_BUREAUS } from "@/lib/array";
import { ArrayEvent, useArrayEvents } from "@/lib/useArrayEvents";
import { createClient } from "@/lib/supabase/client";

type Consumer = {
  id: string;
  display_name: string;
  enrolled_at: string | null;
};

export default function EnrollPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const consumerId = params.id;

  const [consumer, setConsumer] = useState<Consumer | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [failures, setFailures] = useState(0);
  const [recordError, setRecordError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        router.replace("/login");
        return;
      }

      // RLS scopes this to consumers this account owns, so another account's
      // id simply returns nothing.
      const { data: row } = await supabase
        .from("consumers")
        .select("id, display_name, enrolled_at")
        .eq("id", consumerId)
        .maybeSingle();

      if (!row) {
        setNotFound(true);
        return;
      }

      /**
       * Already verified — don't remount the component.
       *
       * Array's create-user endpoint returns 409 Conflict for a userId that
       * already exists, so re-running enrolment for someone who has been
       * through it produces a dead end rather than a second report.
       */
      if (row.enrolled_at) {
        router.replace(`/consumers/${consumerId}/dashboard`);
        return;
      }

      setConsumer(row);
    });
  }, [consumerId, router]);

  useArrayEvents(async (detail) => {
    if (detail.tagName !== ArrayTag.accountEnroll && detail.tagName !== ArrayTag.authenticationKba) {
      return;
    }

    if (detail.event === ArrayEvent.signup) {
      // metadata carries userId, userToken and loginDelay. The token is not
      // sent to our backend — we mint our own server-side.
      const enrolledId = detail.metadata?.userId as string | undefined;

      const res = await fetch("/api/array/enrolled", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consumerId, userId: enrolledId }),
      });

      /**
       * Do not navigate on failure.
       *
       * An earlier version ignored this response and pushed to the dashboard
       * regardless. When recording failed, the dashboard asked for a token,
       * got 409 "not enrolled", and bounced straight back here — so a
       * successful bureau verification looked like the form silently
       * restarting, with the real error never shown anywhere.
       */
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        console.error("Array verification succeeded but enrolment was not recorded", {
          status: res.status,
          error: payload?.error,
          consumerId,
          arrayUserId: enrolledId,
          metadata: detail.metadata,
        });
        setRecordError(
          payload?.error
            ? `${payload.error} (${res.status})`
            : `Couldn't save the result (${res.status}).`
        );
        return;
      }

      router.push(`/consumers/${consumerId}/dashboard`);
    }

    if (detail.event === ArrayEvent.failure) {
      setFailures((n) => n + 1);
    }
  });

  if (notFound) {
    return (
      <main className="shell shell--narrow">
        <p className="notice notice--error" role="alert">
          That client doesn&rsquo;t exist, or isn&rsquo;t yours.
        </p>
        <Link className="button button--quiet" href="/consumers">
          Back to clients
        </Link>
      </main>
    );
  }

  if (!consumer) {
    return (
      <main className="shell shell--narrow">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="shell shell--narrow">
      <header className="page-head">
        <p className="eyebrow">
          <Link href="/consumers">Clients</Link> / {consumer.display_name}
        </p>
        <h1>Verify identity</h1>
        <p className="lede">
          The bureau needs to confirm this person is who they say they are before it will
          release the report. They&rsquo;ll need to provide their Social Security number and
          answer questions only they would know.
        </p>
      </header>

      {/*
        The passcode goes to the client's own phone and the questions are about
        their own credit history, so they have to be reachable while this runs.
        Nothing in the app can change that — it's the bureau's behaviour.
      */}
      <p className="notice" role="note">
        TransUnion sends a one-time passcode to <strong>{consumer.display_name}&rsquo;s</strong>{" "}
        phone. Make sure they&rsquo;re on the call before you start.
      </p>

      {/*
        Verification passed at the bureau but we failed to write it down. The
        consumer has spent a real attempt, so say so plainly rather than
        letting them run the form again.
      */}
      {recordError && (
        <p className="notice notice--error" role="alert">
          Identity was verified, but the result couldn&rsquo;t be saved: {recordError} Don&rsquo;t
          re-run the form — the verification already counted. Check the server logs.
        </p>
      )}

      {failures >= 2 && (
        <p className="notice notice--warning" role="alert">
          Two attempts haven&rsquo;t matched. After four, the bureau locks this report for up
          to 30 days and it can&rsquo;t be overridden. If the questions are about accounts they
          don&rsquo;t recognise, stop here.
        </p>
      )}

      {/*
        userId — the consumer's own row id, so each person is a distinct Array
                 user. A UUID fits Array's 36-character limit exactly.

        uponSuccessShow — deliberately NOT "quickView". That value suppresses
                 the signup event, which is the only place the userId comes back.

        tui/exp/efx — all-or-none. See VERIFICATION_BUREAUS in lib/array.ts.
      */}
      <ArrayComponent
        className="array-host"
        tag={ArrayTag.accountEnroll}
        attributes={{
          userId: consumer.id,
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
