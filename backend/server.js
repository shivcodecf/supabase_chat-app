import express from "express";
import dotenv from "dotenv";
import healthRoutes from "./src/routes/health.js";
import chatRoutes from "./src/routes/chats.js";
import messageRoutes from "./src/routes/messages.js";
import { setupWebsocket, broadcastMessage } from "./src/websocket.js";
import fetch from "node-fetch";
import crypto from "crypto"; // ✅ for generating UUIDs
import cors from "cors";

dotenv.config();

const app = express();
app.use(express.json());

app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true, // set true only if you use cookies
  })
);

// log every request
app.use((req, res, next) => {
  console.log("👉 Incoming:", req.method, req.url);
  next();
});

// ------------------ MESSAGE QUEUE ------------------
let messageQueue = [];

// enqueue message
export function enqueueMessage(msg) {
  if (!msg.client_msg_id) {
    msg.client_msg_id = crypto.randomUUID();
  }

  messageQueue.push(msg);
  console.log("📩 Enqueued message:", msg);

  // broadcast immediately
  broadcastMessage(msg.chat_id, msg);
}

// flush messages to Supabase Edge Function
async function flushQueue() {
  if (messageQueue.length === 0) return;

  const batch = messageQueue.splice(0, 500);
  console.log(`🌀 Flushing ${batch.length} messages to Supabase...`);

  try {
    const url = `${process.env.SUPABASE_URL}/functions/v1/write_batch`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, // ✅ required by Supabase gateway
        "x-secret": process.env.EDGE_FUNCTION_SECRET, // ✅ checked by your function
      },
      body: JSON.stringify({ messages: batch }),
    });

    const text = await resp.text();
    if (!resp.ok) {
      console.error(`❌ Failed to flush batch (${resp.status}): ${text}`);
      // requeue for retry
      messageQueue = [...batch, ...messageQueue];
    } else {
      console.log(`✅ Batch persisted successfully: ${text}`);
    }
  } catch (err) {
    console.error("⚠️ Error flushing batch:", err);
    messageQueue = [...batch, ...messageQueue];
  }
}



// run flush loop every 1s
setInterval(flushQueue, 1000);

// ------------------ ROUTES ------------------
app.use("/api", healthRoutes);
app.use("/api", chatRoutes);
app.use("/api", messageRoutes);

// ------------------ SERVER & WS ------------------
const server = app.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});

setupWebsocket(server);
