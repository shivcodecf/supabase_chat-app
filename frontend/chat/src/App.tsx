import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./services/supabaseClient";
import AuthForm from "./pages/AuthForm";
type Chat = { id: string; name: string | null; is_group: boolean };
type Msg = {
  id?: string;
  chat_id: string;
  sender_id: string;
  content: string;
  inserted_at?: string;
};
export default function App() {
  const [session, setSession] = useState<any>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChat, setCurrentChat] = useState<Chat | null>(null);
  const [history, setHistory] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  // auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSession(s)
    );
    return () => sub.subscription.unsubscribe();
  }, []);
  

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
  
  const wsUrl = useMemo(() => {
    if (!session) return null;
    const token = session.access_token;
    const base = import.meta.env.VITE_SERVER_WS_URL!; // e.g.
    //your-host/ws
    wss: return `${base}?token=${encodeURIComponent(token)}`;
  }, [session]);
  

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
  




  const joinChat = async (chat: Chat) => {
  setCurrentChat(chat);

  
  const { data, error } = await supabase.functions.invoke(
    "get_chat_history",
    {
      body: { chat_id: chat.id, limit: 100 },
      headers: { Authorization: `Bearer ${session.access_token}` },
    }
  );

  if (!error) setHistory(data.reverse());

  // tell server to join this room **after WS is open**
  if (wsRef.current) {
    if (wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "join", chat_id: chat.id }));
    } else {
      wsRef.current.addEventListener(
        "open",
        () => wsRef.current?.send(JSON.stringify({ type: "join", chat_id: chat.id })),
        { once: true } // only fire once
      );
    }
  }
};




  // send message
  const send = () => {
    if (!currentChat || !input.trim()) return;
    wsRef.current?.send(
      JSON.stringify({
        type: "new_message",
        chat_id: currentChat.id,
        content: input.trim(),
      })
    );

    setInput("");
  };
  if (!session) {
    return <AuthForm />;
  }
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
        <ul>
          {chats.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => joinChat(c)}
                style={{
                  width: "100%",
                }}
              >
                {c.name || (c.is_group ? "Group chat" : "DM")}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main>
        <h3>
          {currentChat ? currentChat.name || currentChat.id : "Pick a chat"}
        </h3>

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
              <strong>{m.sender_id.slice(0, 6)}:</strong>
              {m.content}
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
      </main>
    </div>
  );
}
