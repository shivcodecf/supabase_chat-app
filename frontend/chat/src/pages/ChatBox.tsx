import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../services/supabaseClient";
import AuthForm from "./AuthForm";

type Chat = { id: string; name: string | null; is_group: boolean };
type Msg = {
  id?: string;
  chat_id: string;
  sender_id: string;
  content: string;
  inserted_at?: string;
};

export default function ChatBox() {
  const [session, setSession] = useState<any>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChat, setCurrentChat] = useState<Chat | null>(null);
  const [history, setHistory] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  // AUTH
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSession(s)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  // FETCH USER'S CHATS
  useEffect(() => {
    if (!session) return;
    (async () => {
      const uid = session.user.id;
      const { data, error } = await supabase
        .from("chat_members")
        .select("chat_id, chats(name,is_group)")
        .eq("user_id", uid);
      if (error) console.error(error);
      else
        setChats(
          data.map((m: any) => ({
            id: m.chat_id,
            name: m.chats.name,
            is_group: m.chats.is_group,
          }))
        );
    })();
  }, [session]);

  // WEBSOCKET URL
  const wsUrl = useMemo(() => {
    if (!session) return null;
    const token = session.access_token;
    const base = import.meta.env.VITE_SERVER_WS_URL!;
    return `${base}?token=${encodeURIComponent(token)}`;
  }, [session]);

  // WEBSOCKET CONNECTION
  useEffect(() => {
    if (!wsUrl) return;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "new_message" && msg.chat_id === currentChat?.id) {
        setHistory((h) => [...h, msg]);
      }
    };
    wsRef.current = ws;
    return () => ws.close();
  }, [wsUrl, currentChat?.id]);

  // JOIN CHAT
  const joinChat = async (chat: Chat) => {
    setCurrentChat(chat);

    const { data, error } = await supabase.functions.invoke("get_chat_history", {
      body: { chat_id: chat.id, limit: 100 },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (!error) setHistory(data.reverse());

    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "join", chat_id: chat.id }));
      } else {
        wsRef.current.addEventListener(
          "open",
          () =>
            wsRef.current?.send(JSON.stringify({ type: "join", chat_id: chat.id })),
          { once: true }
        );
      }
    }
  };

  // CREATE NEW CHAT
  const createChat = async () => {
    const name = prompt("Enter chat name (optional for group chat):");
    if (!name) return;

    try {
      const { data, error } = await supabase.functions.invoke("create_chat", {
        body: {
          name,
          is_group: true,
          member_ids: [session.user.id], // start with yourself
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) {
        console.error("Failed to create chat:", error.message);
        return;
      }

      // Add the new chat to state
      setChats((prev) => [...prev, { id: data.chat_id, name, is_group: true }]);
    } catch (err) {
      console.error("Error creating chat:", err);
    }
  };

  // LOGOUT
  // logout
const logOut = async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.warn("Logout warning:", error.message);
    } else {
      console.log("User logged out successfully");
    }
    setSession(null); // clear UI state anyway
  } catch (err) {
    console.error("Unexpected logout error:", err);
    setSession(null);
  }
};


  // SEND MESSAGE
  const send = async () => {
    if (!currentChat || !input.trim()) return;

    const messageContent = input.trim();

    try {
      const { data, error } = await supabase.functions.invoke("write_batch", {
        body: {
          messages: [
            {
              chat_id: currentChat.id,
              content: messageContent,
            },
          ],
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) {
        console.error("Failed to send message:", error.message);
        return;
      }

      setInput("");

      setHistory((h) => [
        ...h,
        {
          chat_id: currentChat.id,
          sender_id: session.user.id,
          content: messageContent,
          inserted_at: new Date().toISOString(),
        },
      ]);

      wsRef.current?.send(
        JSON.stringify({
          type: "new_message",
          chat_id: currentChat.id,
          content: messageContent,
        })
      );
    } catch (err) {
      console.error("Error sending message:", err);
    }
  };

  if (!session) return <AuthForm />;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "280px 1fr",
        height: "100vh",
        gap: 16,
        padding: 16,
      }}
    >
      <aside>
        <h3>Chats</h3>
        <button onClick={createChat} style={{ marginBottom: 8 }}>+ New Chat</button>
        <ul>
          {chats.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => joinChat(c)}
                style={{ width: "100%" }}
              >
                {c.name || (c.is_group ? "Group chat" : "DM")}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main>
        <h3>{currentChat ? currentChat.name || currentChat.id : "Pick a chat"}</h3>

        <div
          style={{
            border: "1px solid #ccc",
            height: "70vh",
            overflow: "auto",
            padding: 8,
          }}
        >
          {history.map((m, i) => (
            <div key={i}>
              <strong>{m.sender_id.slice(0, 6)}:</strong> {m.content}
            </div>
          ))}
        </div>

        {currentChat && (
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type..."
              style={{ flex: 1 }}
            />
            <button onClick={send}>Send</button>
          </div>
        )}

        <button onClick={logOut}>Logout</button>
      </main>
    </div>
  );
}
