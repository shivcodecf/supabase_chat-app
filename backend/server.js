import express from "express";
import dotenv from "dotenv";
import healthRoutes from "./src/routes/health.js";
import chatRoutes from "./src/routes/chats.js";
import messageRoutes from "./src/routes/messages.js";
import { setupWebsocket, broadcastMessage } from "./src/websocket.js";

import crypto from "crypto"; 
import cors from "cors";

dotenv.config();

const app = express();
app.use(express.json());

const FRONTEND_URL = process.env.FRONTEND_PUBLIC_URL

app.use(
  cors({
    origin: FRONTEND_URL,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true, 
  })
);


app.use((req, res, next) => {
  console.log(" Incoming:", req.method, req.url);
  next();
});


let messageQueue = [];


export function enqueueMessage(msg) {

  if (!msg.client_msg_id) {

    msg.client_msg_id = crypto.randomUUID();  

  }

  messageQueue.push(msg);

  console.log("Enqueued message:", msg);

  
  broadcastMessage(msg.chat_id, msg);  // 

}



async function flushQueue() {

  if (messageQueue.length === 0) return;

  const batch = messageQueue.splice(0, 500);

  console.log(` Flushing ${batch.length} messages to Supabase...`);

  try {
    const url = `${process.env.SUPABASE_URL}/functions/v1/write_batch`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 
        "x-secret": process.env.EDGE_FUNCTION_SECRET, 
      },
      body: JSON.stringify({ messages: batch }),
    });

    const text = await resp.text();

    if (!resp.ok) {
      console.error(` Failed to flush batch (${resp.status}): ${text}`);
     
      messageQueue = [...batch, ...messageQueue];
    } else {
      console.log(` Batch persisted successfully: ${text}`);
    }
  } catch (err) {
    console.error("Error flushing batch:", err);
    messageQueue = [...batch, ...messageQueue];
  }

}




setInterval(flushQueue, 1000);


app.use("/api", healthRoutes);
app.use("/api", chatRoutes);
app.use("/api", messageRoutes);



const PORT = process.env.PORT | 3000


const server = app.listen(PORT, () => {
  console.log(` Server running on ${PORT}`);
});

setupWebsocket(server);