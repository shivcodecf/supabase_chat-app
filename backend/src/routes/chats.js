import express from "express";
import { supabase } from "../supabaseClient.js";
import { validateJWT } from "../middleware.js";

const router = express.Router();

router.get("/chats", validateJWT, async (req, res) => {

  try {

    if (!req.user || !req.user.id) {

      return res.status(401).json({ error: "Unauthorized: no user info found" });

    }

    const userId = req.user.id;

    console.log("GET /chats for user:", userId);

    // Step 1: Fetch chat memberships
    const { data: memberships, error: err1 } = await supabase
      .from("chat_members")
      .select("chat_id")
      .eq("user_id", userId);

    if (err1) {

      console.error("Error fetching memberships:", err1);

      return res.status(500).json({ error: err1.message });

    }

    const membershipsArray = Array.isArray(memberships) ? memberships : [];

    const chatIds = membershipsArray
      .map(m => m?.chat_id)
      .filter(id => typeof id === "string" || typeof id === "number");

    // Step 2: Return empty array early if no chats
    if (chatIds.length === 0) return res.json([]);

    console.log("Chat IDs to fetch:", chatIds);

    // Step 3: Fetch chats safely using .or() instead of .in()
    const filterString = chatIds.map(id => `id.eq.${id}`).join(',');
    
    const { data: chats, error: err2 } = await supabase
      .from("chats")
      .select("*")
      .or(filterString);

    if (err2) {
      console.error("Error fetching chats:", err2);
      return res.status(500).json({ error: err2.message });
    }

    console.log("Chats fetched:", chats);

    res.json(chats);

  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ error: err.message });
  }

});














router.post("/chats", validateJWT, async (req, res) => {

  const { other_user_id, name, member_ids } = req.body;

  try {

    let is_group = false;

    let members = [];

    if (other_user_id) {
      // Direct chat: just 2 users
      is_group = false;

      members = [req.user.id, other_user_id];

    } else {
      // Group chat: creator + others
      is_group = true;

      members = [req.user.id, ...(member_ids || [])];

    }

    // Create chat
    const { data: chat, error: err1 } = await supabase
      .from("chats")
      .insert({ name, is_group })
      .select()
      .single();

    if (err1) return res.status(500).json({ error: err1.message });

    // Insert members, but ensure the creator is included

    const uniqueMembers = [...new Set(members)];

    if (!uniqueMembers.includes(req.user.id)) {
      uniqueMembers.push(req.user.id);
    }

    const { error: err2 } = await supabase
      .from("chat_members")
      .insert(uniqueMembers.map((uid) => ({
        chat_id: chat.id,
        user_id: uid
      })));

    if (err2) return res.status(500).json({ error: err2.message });

    res.json({ chat_id: chat.id });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }


});


export default router;
