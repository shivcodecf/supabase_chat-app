
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-secret",
  };

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers });

  const secret = req.headers.get("x-secret");  

  if (secret !== Deno.env.get("EDGE_FUNCTION_SECRET")) {

    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers });

  }

  let body;

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers });
  }

  const { messages } = body || {};

  if (!Array.isArray(messages)) {

    return new Response(JSON.stringify({ error: "messages must be an array" }), { status: 400, headers });

  }

  for (const m of messages) {
    if (!m.chat_id || !m.sender_id || !m.content) {
      return new Response(
        JSON.stringify({ error: "Each message must include chat_id, sender_id, and content" }),
        { status: 400, headers }
      );
    }
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! 
  );

  
  const { data, error } = await supabase
    .from("messages")
    .upsert(messages, { onConflict: "chat_id,client_msg_id" })
    .select("id, chat_id, sender_id, content, inserted_at, client_msg_id");

  if (error) {
    console.error("Batch insert error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }

  return new Response(
    JSON.stringify({ success: true, inserted_count: data.length, inserted: data }),
    { status: 200, headers }
  );
});
