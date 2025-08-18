// supabase/functions/write_batch/index.ts
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Not Found", { status: 404 });
  }

  // Require auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,   // use anon key
    {
      global: { headers: { Authorization: authHeader } } // attach JWT
    }
  );

  // Parse body → only "messages"
  const { messages } = await req.json();

  if (!messages || !Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: "messages must be an array" }), { status: 400 });
  }

  // Get user from JWT
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Invalid user" }), { status: 401 });
  }

  const senderId = user.id;

  // Attach senderId to each message
  const messagesWithSender = messages.map((msg: any) => ({
    chat_id: msg.chat_id,   // each message includes its chat_id
    sender_id: senderId,    // force sender from JWT
    content: msg.content,
  }));

  // Insert messages
  const { error } = await supabase.from("messages").insert(messagesWithSender);

  if (error) {
    console.error("Batch insert error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
});
