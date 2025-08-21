import express from "express";
import { validateJWT } from "../middleware.js";
import { enqueueMessage } from "../../server.js"; // note the path
import { broadcastMessage } from "../websocket.js";
import crypto from "crypto";

const router = express.Router();

// GET /api/chats/:chat_id/messages
router.get("/chats/:chat_id/messages", validateJWT, async (req, res) => {
  try {
    // Call your Edge Function (POST) with user JWT for RLS-safe read
    const resp = await fetch(
      `${process.env.SUPABASE_URL}/functions/v1/get_chat_history`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: req.headers.authorization || "",
        },
        body: JSON.stringify({
          chat_id: req.params.chat_id,
          limit: Number.isFinite(+req.query.limit) ? +req.query.limit : 100,
        }),
      }
    );

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: text });
    }

    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("❌ Error fetching chat history:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chats/:chat_id/messages
// messages.js (server)
router.post("/chats/:chat_id/messages", validateJWT, async (req, res) => {
  const { chat_id } = req.params;
  const { content, client_msg_id } = req.body || {};

  try {
    if (!chat_id) return res.status(400).json({ error: "chat_id is required" });
    if (!content?.trim()) return res.status(400).json({ error: "content is required" });
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });

    const msg = {
      chat_id,
      sender_id: req.user.id,
      content: content.trim(),
      inserted_at: new Date().toISOString(),
      client_msg_id: client_msg_id || crypto.randomUUID(),
    };

    console.log("[POST /messages] enqueue + broadcast ->", msg);

    enqueueMessage(msg);              // queue for DB
    broadcastMessage(chat_id, msg);   // 🔥 WS broadcast NOW

    return res.status(202).json({ status: "enqueued", client_msg_id: msg.client_msg_id });
  } catch (err) {
    console.error("[POST /messages] error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});


export default router;
