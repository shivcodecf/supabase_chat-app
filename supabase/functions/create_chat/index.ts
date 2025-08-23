
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "https://supabase-chat-app-gilt.vercel.app", 
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-client-info, apikey",
  };

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers });
  }

  try {
    const body = await req.json();
    const { name = null, is_group = true, member_ids = [], other_user_email } = body ?? {};

   
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid user token" }), { status: 401, headers });
    }

    
    const allMemberIds = new Set<string>([user.id]); 

    
    if (other_user_email && typeof other_user_email === "string") {
      const email = other_user_email.trim();
      if (email) {
        const adminUrl = `${Deno.env.get("SUPABASE_URL")}/auth/v1/admin/users?email=${encodeURIComponent(email)}`;
        const resp = await fetch(adminUrl, {
          headers: {
            apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
            "Content-Type": "application/json",
          },
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          return new Response(
            JSON.stringify({ error: `Admin email lookup failed (${resp.status}): ${text || resp.statusText}` }),
            { status: 500, headers }
          );
        }

        const json = await resp.json().catch(() => ({}));
        const other = Array.isArray(json.users) ? json.users[0] : null;
        if (!other?.id) {
          return new Response(JSON.stringify({ error: `No user found for email: ${email}` }), { status: 404, headers });
        }

        allMemberIds.add(other.id);
      }
    }

    
    if (Array.isArray(member_ids)) {
      for (const id of member_ids) if (typeof id === "string" && id) allMemberIds.add(id);
    }

    
    const supabaseSrv = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    
    const { data: chat, error: chatErr } = await supabaseSrv
      .from("chats")
      .insert({ name, is_group: other_user_email ? false : !!is_group })
      .select()
      .single();

    if (chatErr) {
      return new Response(JSON.stringify({ error: chatErr.message }), { status: 500, headers });
    }

    
    const rows = Array.from(allMemberIds).map((uid) => ({ chat_id: chat.id, user_id: uid }));
    const { error: memErr } = await supabaseSrv.from("chat_members").insert(rows);
    if (memErr) {
      return new Response(JSON.stringify({ error: memErr.message }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ chat_id: chat.id }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers });
  }
});
