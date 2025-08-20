import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

serve(async (req) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://localhost:5173", // frontend origin
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, x-client-info, apikey",
  };

  // ✅ Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {

    return new Response(null, { status: 204, headers });

  }

  if (req.method !== "POST") {

    return new Response("Not Found", { status: 404, headers });

  }

  try {

    const { is_group, name, member_ids } = await req.json();

    // Get auth token from headers
    const authHeader = req.headers.get("Authorization");


    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers,
      });
    }

    // Create Supabase client WITH user token
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {

      global: { headers: { Authorization: authHeader } },

    });

    // Check current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid user token" }), {
        status: 401,
        headers,
      });
    }

    // Insert chat
    const { data: chat, error: err1 } = await supabase
      .from("chats")
      .insert({ name, is_group: is_group ?? false })
      .select()
      .single();      // returns  newly  inserted  row

    if (err1) {
      return new Response(JSON.stringify({ error: err1.message }), {
        status: 500,
        headers,
      });
    }

    const chatId = chat.id;

    // Add members (including creator)

    const allMemberIds = member_ids || [];

    if (!allMemberIds.includes(user.id)) allMemberIds.push(user.id);

    const { error: err2 } = await supabase
      .from("chat_members")
      .insert(
        allMemberIds.map((uid: string) => ({ chat_id: chatId, user_id: uid }))
      );

    if (err2) {
      return new Response(JSON.stringify({ error: err2.message }), {
        status: 500,
        headers,
      });
    }

    return new Response(JSON.stringify({ chat_id: chatId }), {
      status: 200,
      headers,
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers,
    });
  }
});
