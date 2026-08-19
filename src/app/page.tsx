import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * There is no marketing page here — mistake.com stays on Webflow and links to
 * this subdomain. Land people wherever they actually are in the flow.
 */
export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("array_user_id")
    .eq("id", user.id)
    .maybeSingle();

  redirect(profile?.array_user_id ? "/dashboard" : "/enroll");
}
