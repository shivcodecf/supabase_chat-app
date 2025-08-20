import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ noServer: true });
const clients = new Map(); // chat_id -> Set of sockets

export function setupWebsocket(server) {
  server.on("upgrade", (req, socket, head) => {
    if (req.url === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });

  wss.on("connection", (ws) => {
    ws.on("message", (message) => {
      const data = JSON.parse(message);
      if (data.type === "join") {
        if (!clients.has(data.chat_id)) clients.set(data.chat_id, new Set());
        clients.get(data.chat_id).add(ws);
      }
    });

    ws.on("close", () => {
      for (const set of clients.values()) set.delete(ws);
    });
  });
}

export function broadcastMessage(chatId, msg) {
  if (!clients.has(chatId)) return;
  for (const ws of clients.get(chatId)) {
    ws.send(JSON.stringify(msg));
  }
}
