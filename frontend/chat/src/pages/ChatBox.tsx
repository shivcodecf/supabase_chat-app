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
  client_msg_id?: string;
};

export default function ChatBox() {
  const [session, setSession] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);

  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChat, setCurrentChat] = useState<Chat | null>(null);
  const [history, setHistory] = useState<Msg[]>([]);
  const [input, setInput] = useState("");

  const initOnceRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // ---------- AUTH ----------
  useEffect(() => {
    if (initOnceRef.current) return;
    initOnceRef.current = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
      setAuthReady(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // ---------- Restore cached chats ----------
  useEffect(() => {
    const cached = localStorage.getItem("my_chats_cache");
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) setChats(parsed);
      } catch {}
    }
  }, []);

  // ---------- Fetch my chats ----------
  const fetchMyChats = async (uid: string) => {
    const { data: memberships, error: mErr } = await supabase
      .from("chat_members")
      .select("chat_id")
      .eq("user_id", uid);

    if (mErr) {
      console.error("[fetchMyChats] memberships error:", mErr);
      return;
    }

    const ids = (memberships ?? []).map((m: any) => m?.chat_id).filter(Boolean);
    if (ids.length === 0) {
      setChats([]);
      localStorage.setItem("my_chats_cache", JSON.stringify([]));
      return;
    }

    const { data: chatRows, error: cErr } = await supabase
      .from("chats")
      .select("id,name,is_group")
      .in("id", ids);

    if (cErr) {
      console.error("[fetchMyChats] chats error:", cErr);
      return;
    }

    const mapped: Chat[] = (chatRows ?? []).map((c: any) => ({
      id: c.id,
      name: c.name ?? null,
      is_group: !!c.is_group,
    }));

    setChats(mapped);
    localStorage.setItem("my_chats_cache", JSON.stringify(mapped));
  };

  useEffect(() => {
    if (!authReady || !session) return;
    fetchMyChats(session.user.id);
  }, [authReady, session]);

  // ---------- Live refresh ----------
  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel("chats-for-me")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_members",
          filter: `user_id=eq.${session.user.id}`,
        },
        () => fetchMyChats(session.user.id)
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session]);

  // ---------- WebSocket ----------
  const wsUrl = useMemo(() => {
    if (!session) return null;
    const token = session.access_token;
    const base = import.meta.env.VITE_SERVER_WS_URL!; // ws://localhost:3000/ws
    return `${base}?token=${encodeURIComponent(token)}`;
  }, [session]);

  useEffect(() => {
    if (!wsUrl) return;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("[ws] open");

      // join last chat if known
      const last = currentChat?.id || localStorage.getItem("last_chat_id");
      if (last) {
        console.log("[ws] auto-joining chat", last);
        ws.send(JSON.stringify({ type: "join", chat_id: last }));
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        console.log("[ws] incoming", msg);

        if (msg.type === "joined") {
          console.log(`[ws] ACK joined room ${msg.chat_id} (size=${msg.size})`);
          return;
        }

        if (msg.type !== "new_message") return;
        if (msg.chat_id !== currentChat?.id) return;

        const key =
          msg.client_msg_id ||
          msg.id ||
          `${msg.chat_id}:${msg.sender_id}:${msg.inserted_at}:${msg.content}`;
        if (seenIdsRef.current.has(key)) return;
        seenIdsRef.current.add(key);

        setHistory((h) => [...h, msg]);
      } catch (err) {
        console.warn("[ws] bad message", err);
      }
    };

    ws.onerror = (e) => console.warn("[ws] error", e);
    ws.onclose = () => console.warn("[ws] close");

    wsRef.current = ws;
    return () => ws.close();
  }, [wsUrl, currentChat?.id]);

  // ---------- Join chat ----------
  const joinChat = async (chat: Chat) => {
    setCurrentChat(chat);
    localStorage.setItem("last_chat_id", chat.id);
    seenIdsRef.current.clear();

    try {
      const { data, error } = await supabase.functions.invoke(
        "get_chat_history",
        {
          body: { chat_id: chat.id, limit: 100 },
          headers: { Authorization: `Bearer ${session.access_token}` },
        }
      );

      if (!error && Array.isArray(data)) {
        data.forEach((m: Msg) => {
          const key =
            m.client_msg_id ||
            m.id ||
            `${m.chat_id}:${m.sender_id}:${m.inserted_at}:${m.content}`;
          seenIdsRef.current.add(key);
        });
        setHistory(data.reverse());
      }
    } catch (err) {
      console.error("[joinChat] history error:", err);
    }

    if (wsRef.current) {
      const sendJoin = () => {
        console.log("[ws] sending join from joinChat", chat.id);
        wsRef.current?.send(JSON.stringify({ type: "join", chat_id: chat.id }));
      };
      if (wsRef.current.readyState === WebSocket.OPEN) sendJoin();
      else wsRef.current.addEventListener("open", sendJoin, { once: true });
    }
  };

  // ---------- Auto-open last chat ----------
  useEffect(() => {
    if (!session || chats.length === 0) return;
    const last = localStorage.getItem("last_chat_id");
    if (!last) return;
    const found = chats.find((c) => c.id === last);
    if (found && (!currentChat || currentChat.id !== found.id)) {
      joinChat(found);
    }
  }, [session, chats]);

  // ---------- Create chat ----------
  const createChat = async () => {
    const name = prompt("Enter chat name (optional for group chat):");
    if (!name) return;

    const { data, error } = await supabase.functions.invoke("create_chat", {
      body: { name, is_group: true, member_ids: [session.user.id] },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (error) {
      console.error("[create_chat] error:", error.message);
      return;
    }

    const newChat: Chat = { id: data.chat_id, name, is_group: true };
    setChats((prev) => {
      const next = [...prev, newChat];
      localStorage.setItem("my_chats_cache", JSON.stringify(next));
      return next;
    });
    joinChat(newChat);
  };

  // ---------- Logout ----------
  const logOut = async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      setSession(null);
      setChats([]);
      setCurrentChat(null);
      setHistory([]);
      localStorage.removeItem("last_chat_id");
      localStorage.removeItem("my_chats_cache");
      seenIdsRef.current.clear();
    }
  };

  // ---------- Send ----------
    const send = async () => {
    if (!currentChat || !input.trim()) return;
    const messageContent = input.trim();
    const clientMsgId = crypto.randomUUID();

    // seed dedupe immediately
    seenIdsRef.current.add(clientMsgId);

    const res = await fetch(
      `http://localhost:3000/api/chats/${currentChat.id}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          content: messageContent,
          client_msg_id: clientMsgId,
        }),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[send] failed:", err.error || res.statusText);
      return;
    }

    setInput("");

    // Optimistically add message (temporary until WS echo confirms)
    setHistory((h) => [
      ...h,
      {
        chat_id: currentChat.id,
        sender_id: session.user.id,
        content: messageContent,
        inserted_at: new Date().toISOString(),
        client_msg_id: clientMsgId,
      },
    ]);
  };


  // ---------- Render ----------
  if (!authReady) return <div style={{ padding: 16 }}>Loading…</div>;
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
        <button onClick={createChat} style={{ marginBottom: 8 }}>
          + New Chat
        </button>
        <ul>
          {chats.map((c) => (
            <li key={c.id}>
              <button onClick={() => joinChat(c)} style={{ width: "100%" }}>
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
            <div key={m.client_msg_id || m.id || i.toString()}>
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
