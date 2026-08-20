"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ArrayComponent from "@/components/ArrayComponent";
import { ArrayTag } from "@/lib/array";
import { ArrayEvent, useArrayEvents, redactMetadata } from "@/lib/useArrayEvents";
import { useArrayToken } from "@/lib/useArrayToken";
import { createClient } from "@/lib/supabase/client";

type View = "overview" | "report" | "insights" | "debt";

const VIEWS: { id: View; label: string; tag: (typeof ArrayTag)[keyof typeof ArrayTag] }[] = [
  { id: "overview", label: "Overview", tag: ArrayTag.creditOverview },
  { id: "report", label: "Full report", tag: ArrayTag.creditReport },
  { id: "insights", label: "What's affecting the score", tag: ArrayTag.creditScoreInsights },
  { id: "debt", label: "Debt analysis", tag: ArrayTag.creditDebtAnalysis },
];

export default function DashboardPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const consumerId = params.id;

  const { userToken, status, refresh } = useArrayToken(consumerId);
  const [view, setView] = useState<View>("overview");
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("consumers")
      .select("display_name")
      .eq("id", consumerId)
      .maybeSingle()
      .then(({ data }) => setName(data?.display_name ?? null));
  }, [consumerId]);

  useEffect(() => {
    if (status === "unenrolled") router.replace(`/consumers/${consumerId}/enroll`);
    if (status === "notfound") router.replace("/consumers");
  }, [status, consumerId, router]);

  useArrayEvents((detail) => {
    // "logout" fires both when a logout happens and when an underlying Array
    // call returns 401/403 on an expired token. The event doesn't distinguish
    // them, so try a silent refresh first.
    if (detail.event === ArrayEvent.logout) {
      void refresh();
    }

    // Per-pull billing means it's worth keeping a local record of what was
    // ordered, to reconcile against Array's invoice — now per consumer.
    //
    // TODO: confirm with Array which event actually corresponds to a billable
    // pull. "loaded" on the report component is a guess.
    if (detail.tagName === ArrayTag.creditReport && detail.event === ArrayEvent.loaded) {
      void fetch("/api/array/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          consumerId,
          tagName: detail.tagName,
          event: detail.event,
          metadata: redactMetadata(detail.metadata),
        }),
      }).catch(() => {
        /* auditing must never break the session */
      });
    }
  });

  if (status === "loading") {
    return (
      <main className="shell">
        <p className="muted">Loading credit profile…</p>
      </main>
    );
  }

  if (status === "error" || !userToken) {
    return (
      <main className="shell">
        <p className="notice notice--error" role="alert">
          Couldn&rsquo;t open this credit profile. Try again.
        </p>
        <button className="button" onClick={() => void refresh()}>
          Try again
        </button>
      </main>
    );
  }

  const active = VIEWS.find((v) => v.id === view)!;

  return (
    <main className="shell">
      <header className="page-head">
        <p className="eyebrow">
          <Link href="/consumers">Clients</Link> / {name ?? "…"}
        </p>
        <h1>Credit</h1>
        <p className="lede">From TransUnion. Refreshed each time this page is opened.</p>
      </header>

      <nav className="tabs" aria-label="Credit sections">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className="tab"
            aria-current={v.id === view ? "page" : undefined}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </nav>

      {/*
        Each Array component gets the same userToken. When it refreshes, the
        attribute updates in place rather than the element remounting — see
        ArrayComponent for why that matters.
      */}
      <ArrayComponent
        className="array-host"
        key={active.id}
        tag={active.tag}
        attributes={{
          userToken,
          ...(active.id === "overview" ? { bureau: "tui" } : {}),
          ...(active.id === "report" ? { defaultBureau: "tui" } : {}),
        }}
      />
    </main>
  );
}
