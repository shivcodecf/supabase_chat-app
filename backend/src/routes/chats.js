// src/routes/chats.js
import express from "express";
import { validateJWT } from "../middleware.js";
import { supabase } from "../supabaseClient.js";

const router = express.Router();

/**
 * Helper: find a Supabase user by email using GoTrue Admin REST API
 * Requires SERVICE ROLE key (server-side only!)
 */
async function adminFindUserByEmail(email) {
  const url = `${process.env.SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`;

  const resp = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,        // 👈 required
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, // 👈 required
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Admin email lookup failed (${resp.status}): ${text || resp.statusText}`);
  }

  const json = await resp.json().catch(() => ({}));
  // Response: { users: [ ... ] }
  const user = Array.isArray(json.users) ? json.users[0] : null;
  return user || null;
}


/**
 * GET /api/chats
 * Return all chats for the authenticated user
 */
router.get("/chats", validateJWT, async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });

    // fetch memberships
    const { data: memberships, error: mErr } = await supabase
      .from("chat_members")
      .select("chat_id")
      .eq("user_id", req.user.id);

    if (mErr) return res.status(500).json({ error: mErr.message });

    const ids = (memberships ?? []).map((m) => m?.chat_id).filter(Boolean);
    if (ids.length === 0) return res.json([]);

    // fetch chats
    const { data: chats, error: cErr } = await supabase
      .from("chats")
      .select("id, name, is_group")
      .in("id", ids);

    if (cErr) return res.status(500).json({ error: cErr.message });

    res.json(chats ?? []);
  } catch (err) {
    console.error("[GET /api/chats] error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/chats
 * Create a DM (other_user_email) or group (member_ids) chat
 * body: { name?, other_user_email?, member_ids?[] }
 */
router.post("/chats", validateJWT, async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });

    const creatorId = req.user.id;
    const { name, other_user_email, member_ids } = req.body || {};

    // Build member set (no TS generics in JS)
    const members = new Set([creatorId]);

    let is_group = true;

    if (other_user_email && typeof other_user_email === "string") {
      // DM flow: resolve other user by email via admin REST
      const other = await adminFindUserByEmail(other_user_email.trim());
      if (!other) {
        return res
          .status(404)
          .json({ error: `No user found for email: ${other_user_email}` });
      }
      members.add(other.id);
      is_group = false;
    } else if (Array.isArray(member_ids)) {
      // group flow: add provided member ids
      for (const id of member_ids) {
        if (typeof id === "string" && id) members.add(id);
      }
      is_group = true;
    }

    // Create the chat
    const { data: chat, error: chatErr } = await supabase
      .from("chats")
      .insert({ name: name || null, is_group })
      .select()
      .single();

    if (chatErr) return res.status(500).json({ error: chatErr.message });

    // Insert memberships
    const rows = Array.from(members).map((uid) => ({
      chat_id: chat.id,
      user_id: uid,
    }));

    const { error: memErr } = await supabase.from("chat_members").insert(rows);
    if (memErr) return res.status(500).json({ error: memErr.message });

    return res.json({ chat_id: chat.id });
  } catch (err) {
    console.error("[POST /api/chats] error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
