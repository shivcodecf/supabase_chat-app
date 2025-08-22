import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://localhost:5173",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, x-client-info, apikey",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers,
    });
  }

  const { chat_id, limit } = await req.json();
  if (!chat_id) {
    return new Response(JSON.stringify({ error: "chat_id is required" }), {
      status: 400,
      headers,
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers,
    });
  }

  // use anon key + user JWT so RLS applies as the user
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  // who is calling?
  const { data: { user }, error: userErr } = await supabase.auth.getUser();

  if (userErr || !user) {
    return new Response(JSON.stringify({ error: "Invalid user" }), {
      status: 401,
      headers,
    });
  }

  // must be a member of this chat
  const { data: membership, error: memErr } = await supabase
    .from("chat_members")
    .select("chat_id")
    .eq("chat_id", chat_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memErr) {
    return new Response(JSON.stringify({ error: memErr.message }), {
      status: 500,
      headers,
    });
  }


  if (!membership) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers,
    });
  }


  // fetch messages
  
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("chat_id", chat_id)
    .order("inserted_at", { ascending: true })
    .limit(Number.isFinite(+limit) ? +limit : 100);



  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers,
    });
  }

  return new Response(JSON.stringify(data), { status: 200, headers });
});
