import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://localhost:5173", // adjust to your frontend
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-client-info, apikey",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers });
  }

  try {

    const { name, is_group = true, member_ids = [] } = await req.json();

    // 1) Verify caller with user token (anon client + Authorization header)

    const authHeader = req.headers.get("Authorization"); //  getting the Jwt from supabase

    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid user token" }), { status: 401, headers });
    }

    // 2) Use service-role client to perform inserts (bypasses RLS) beacuse login user has not permissions to add chat of other members
    const supabaseSrv = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ensure creator is in the member list
    const allMemberIds = Array.from(new Set([user.id, ...member_ids]));

    // create chat
    const { data: chat, error: insertChatErr } = await supabaseSrv
      .from("chats")
      .insert({ name, is_group })
      .select()
      .single();



    if (insertChatErr) {
      return new Response(JSON.stringify({ error: insertChatErr.message }), { status: 500, headers });
    }


    // create memberships
    const rows = allMemberIds.map((uid: string) => ({ chat_id: chat.id, user_id: uid }));


    const { error: insertMembersErr } = await supabaseSrv
      .from("chat_members")
      .insert(rows);


    if (insertMembersErr) {
      return new Response(JSON.stringify({ error: insertMembersErr.message }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ chat_id: chat.id }), { status: 200, headers });
    
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers });
  }
});
