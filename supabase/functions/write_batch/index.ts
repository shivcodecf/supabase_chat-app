import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://localhost:5173",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-client-info, apikey",
  };

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers });
  }

  // Require auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { messages } = await req.json();
  if (!messages || !Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: "messages must be an array" }), { status: 400, headers });
  }

  // Get user from JWT
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Invalid user" }), { status: 401, headers });
  }

  const senderId = user.id;

  // Attach senderId to each message and ensure chat_id is valid
  const messagesWithSender = messages.map((msg: any) => ({
    chat_id: msg.chat_id || crypto.randomUUID(),
    sender_id: senderId,
    content: msg.content,
  }));

  // Insert messages
  const { data, error } = await supabase
    .from("messages")
    .insert(messagesWithSender)
    .select();

  if (error) {
    console.error("Batch insert error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }

  return new Response(JSON.stringify({ success: true, inserted: data }), { status: 200, headers });
});
