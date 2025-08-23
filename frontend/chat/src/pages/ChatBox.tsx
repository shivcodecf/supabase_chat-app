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

  // ---------- Fetch my chats (Supabase, RLS) ----------
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

  // ---------- Live refresh of chat list (Supabase Realtime) ----------

  useEffect(() => {

    if (!session) return;

    const channel = supabase
      .channel("my-chats-live")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_members",
          filter: `user_id=eq.${session.user.id}`,
        },
        () => fetchMyChats(session.user.id)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };

  }, [session]);


  // ---------- WebSocket (for live messages only) ----------
  const wsUrl = useMemo(() => {
    if (!session) return null;
    const token = session.access_token;
    const base = import.meta.env.VITE_SERVER_WS_URL!; // e.g. ws://localhost:3000/ws
    return `${base}?token=${encodeURIComponent(token)}`;
  }, [session]);

  useEffect(() => {
    if (!wsUrl) return;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      const last = currentChat?.id || localStorage.getItem("last_chat_id");
      if (last) {
        ws.send(JSON.stringify({ type: "join", chat_id: last }));
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);

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
        setHistory(data.reverse()); // oldest -> newest
      }
    } catch (err) {
      console.error("[joinChat] history error:", err);
    }

    if (wsRef.current) {
      const sendJoin = () =>
        wsRef.current?.send(JSON.stringify({ type: "join", chat_id: chat.id }));
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

  // ---------- Create chat (Edge Function: create_chat) ----------
  const createChat = async () => {
    const name = prompt("Enter chat name (optional):") || null;
    const email = prompt(
      "Enter the other user's email for a DM (leave blank for group):"
    )?.trim();

    const payload: any = email
      ? { name, is_group: false, member_ids: [], other_user_email: email } // your EF can ignore member_ids for DM
      : { name, is_group: true, member_ids: [session.user.id] };

    try {
      const { data, error } = await supabase.functions.invoke("create_chat", {
        body: payload,
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) {
        console.error("[create_chat] failed:", error.message);
        alert(error.message || "Failed to create chat");
        return;
      }

      const chat_id = data?.chat_id;
      if (!chat_id) return;

      // Optimistic add; the other user will get the row via Realtime (chat_members)
      const newChat = {
        id: chat_id,
        name: name || (payload.is_group ? "Group chat" : "DM"),
        is_group: !!payload.is_group,
      };

      setChats((prev) => {
        if (prev.some((c) => c.id === chat_id)) return prev;
        const next = [...prev, newChat];
        localStorage.setItem("my_chats_cache", JSON.stringify(next));
        return next;
      });

      await joinChat(newChat);
    } catch (e: any) {
      console.error("[createChat] error:", e);
      alert(e.message || "Failed to create chat");
    }
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

  // ---------- Send message ----------
  // NOTE: We keep REST here so it persists through your existing server queue.
  const send = async () => {
    if (!currentChat || !input.trim()) return;
    const messageContent = input.trim();
    const clientMsgId = crypto.randomUUID();

    // dedupe seed
    seenIdsRef.current.add(clientMsgId);

     const API_URL = import.meta.env.VITE_BACKEND_PUBLIC_API_URL;

    const res = await fetch(

     

      `${API_URL}/api/chats/${currentChat.id}/messages`,
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
    // Optimistic message (WS echo will keep in sync)
    setHistory((h) => [
      ...h,
      {
        chat_id: currentChat.id,
        sender_id: session.user.id,
        content: messageContent,
        inserted_at: new Date().toISOString(),
        client_msg_id: clientMsgId,
        id: clientMsgId,
      },
    ]);
  };

  // ---------- Render ----------
  if (!authReady) return <div className="p-4">Loading…</div>;
  if (!session) return <AuthForm />;

  return (
    <div className="grid h-screen grid-cols-[280px_1fr] gap-4 p-4 bg-gray-50">
      {/* Sidebar */}
      <aside className="flex flex-col rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800">Chats</h3>
          <button
            onClick={createChat}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 active:scale-[.98] transition"
          >
            + New
          </button>
        </div>

        <ul className="flex-1 overflow-auto p-2">
          {chats.map((c) => (
            <li key={c.id} className="p-1">
              <button
                onClick={() => joinChat(c)}
                className={`w-full rounded-xl px-3 py-2 text-left transition border
                  ${
                    currentChat?.id === c.id
                      ? "bg-indigo-50 border-indigo-200 text-indigo-900"
                      : "bg-white hover:bg-gray-50 border-gray-200 text-gray-800"
                  }`}
              >
                <div className="text-sm font-medium">
                  {c.name || (c.is_group ? "Group chat" : "DM")}
                </div>
                <div className="text-xs text-gray-500 truncate">{c.id}</div>
              </button>
            </li>
          ))}
          {chats.length === 0 && (
            <div className="p-4 text-sm text-gray-500">No chats yet.</div>
          )}
        </ul>

        <div className="p-3 border-t border-gray-100">
          <button
            onClick={logOut}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex flex-col rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800">
            {currentChat ? currentChat.name || currentChat.id : "Pick a chat"}
          </h3>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-2">
          {history.map((m, i) => (
            <div
              key={m.client_msg_id || m.id || i.toString()}
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm"
            >
              <span className="mr-2 font-semibold text-gray-800">
                {m.sender_id.slice(0, 6)}:
              </span>
              <span className="text-gray-700">{m.content}</span>
            </div>
          ))}
          {currentChat && history.length === 0 && (
            <div className="text-sm text-gray-500">No messages yet.</div>
          )}
        </div>

        {currentChat && (
          <div className="flex gap-2 p-3 border-t border-gray-100">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message…"
              className="flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <button
              onClick={send}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 active:scale-[.98] transition"
            >
              Send
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
