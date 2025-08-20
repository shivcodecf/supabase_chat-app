// supabase/functions/get_chat_history/index.ts
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {

  // CORS headers

  const headers = {

    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://localhost:5173", // frontend origin
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-client-info, apikey",

  };

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {

    return new Response(null, { status: 204, headers });

  }

  // Only allow POST
  if (req.method !== "POST") {

    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers });

  }

  // Parse request body

  const { chat_id, limit } = await req.json();


  if (!chat_id) {

    return new Response(JSON.stringify({ error: "chat_id is required" }), { status: 400, headers });

  }

  // Require Authorization header

  const authHeader = req.headers.get("Authorization");


  if (!authHeader) {

    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });

  }

  // Create Supabase client with anon key and JWT

  const supabase = createClient(


    Deno.env.get("SUPABASE_URL")!,

    Deno.env.get("SUPABASE_ANON_KEY")!,


    {
      global: { headers: { Authorization: authHeader } },
    }
    

  );



  // Fetch messages
  const { data, error } = await supabase

    .from("messages")
    .select("*")
    .eq("chat_id", chat_id)
    .order("inserted_at", { ascending: false })
    .limit(limit || 100);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }

  return new Response(JSON.stringify(data), { status: 200, headers });

});
