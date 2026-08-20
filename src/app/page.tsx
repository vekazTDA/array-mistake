import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * There is no marketing page here — mistake.com stays on Webflow and links to
 * this subdomain. Land staff on their client list.
 */
export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/consumers" : "/login");
}
