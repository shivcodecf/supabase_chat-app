import express from "express";
import { supabase } from "../supabaseClient.js";
import { validateJWT } from "../middleware.js";
import { broadcastMessage } from "../websocket.js";

const router = express.Router();

router.get("/chats/:chat_id/messages", validateJWT, async (req, res) => {
  const limit = parseInt(req.query.limit || "100", 10);

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("chat_id", req.params.chat_id)
    .order("inserted_at", { ascending: true })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});



router.post("/chats/:chat_id/messages", validateJWT, async (req, res) => {
  const { chat_id } = req.params;
  const { content } = req.body;

  if (!content) {
    return res.status(400).json({ error: "Message content is required" });
  }

  try {
    // 1️⃣ Insert the message into Supabase
    const { data: message, error } = await supabase
      .from("messages")
      .insert([
        {
          chat_id,
          sender_id: req.user.id, // from JWT
          content,
          inserted_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: error.message });
    }

    // 2️⃣ Optional: broadcast message to connected clients
    if (typeof broadcastMessage === "function") {
      broadcastMessage(chat_id, message);
    }

    // 3️⃣ Respond with the saved message
    res.status(200).json(message);

  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ error: err.message });
  }
});



export default router;
