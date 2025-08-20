import express from "express";
import dotenv from "dotenv";
import healthRoutes from "./src/routes/health.js";
import chatRoutes from "./src/routes/chats.js";
import messageRoutes from "./src/routes/messages.js";
import { setupWebsocket } from "./src/websocket.js";

dotenv.config();

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  console.log("Incoming:", req.method, req.url);
  next();
});


// Routes
app.use("/api", healthRoutes);
app.use("/api", chatRoutes);
app.use("/api", messageRoutes);

const server = app.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});




// WebSocket
setupWebsocket(server);
