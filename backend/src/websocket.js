import { WebSocketServer } from "ws";
import { enqueueMessage } from "../server.js";

const wss = new WebSocketServer({ noServer: true });
const clients = new Map(); // chat_id -> Set<WebSocket>

export function setupWebsocket(server) {
  
  server.on("upgrade", (req, socket, head) => {
    // accept /ws even with query string
    let pathname = "";

    try {

      const url = new URL(req.url, `http://${req.headers.host}`);
      pathname = url.pathname;

    } catch {

      socket.destroy();
      return;

    }
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.on("pong", () => (ws.isAlive = true));

    ws.on("message", (raw) => {
      let data;
      try { data = JSON.parse(raw); } catch { return; }

      // --- JOIN ROOM ---
      if (data.type === "join" && data.chat_id) {
        if (!clients.has(data.chat_id)) clients.set(data.chat_id, new Set());
        clients.get(data.chat_id).add(ws);
        const size = clients.get(data.chat_id).size;
        console.log(`[ws] joined room=${data.chat_id} size=${size}`);

        // ACK so the client knows it’s in the room
        try {
          ws.send(JSON.stringify({ type: "joined", chat_id: data.chat_id, size }));
        } catch {}
        return;
      }

      // --- OPTIONAL: SEND MESSAGE OVER WS (you mostly post via REST) ---
      if (data.type === "message" && data.chat_id && data.content) {
        const msg = {
          chat_id: data.chat_id,
          sender_id: data.sender_id,
          content: data.content,
          inserted_at: new Date().toISOString(),
          client_msg_id: data.client_msg_id,
        };
        enqueueMessage(msg);
        broadcastMessage(data.chat_id, msg); // will send type:new_message payload
      }
    });

    ws.on("close", () => {
      for (const [chatId, set] of clients) {
        if (set.delete(ws)) {
          console.log(`[ws] left room=${chatId} size=${set.size}`);
          if (set.size === 0) clients.delete(chatId);
        }
      }
    });
  });

  // keep-alive
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, 30000);
  wss.on("close", () => clearInterval(interval));
}

export function broadcastMessage(chatId, msg) {
  const set = clients.get(chatId);
  if (!set) return;
  const payload = JSON.stringify({ type: "new_message", ...msg });
  let sent = 0;
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
      sent++;
    }
  }
  console.log(`[ws] broadcast chat=${chatId} sent=${sent}`);
}