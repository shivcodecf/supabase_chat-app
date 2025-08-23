import { useEffect, useState } from "react";
import { supabase } from "./services/supabaseClient";

import "./App.css";
import AuthForm from "./pages/AuthForm";
import ChatBox from "./pages/ChatBox";

function App() {
  const [session, setSession] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {

    // 1. Fetch current session once at startup

    supabase.auth.getSession().then(({ data }) => {

      setSession(data.session);

      setAuthReady(true);

    });

    // 2. Subscribe to login/logout changes

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {

      setSession(newSession);

    });


    // cleanup
    return () => subscription.unsubscribe();
    

  }, []);

  if (!authReady) {
    return <div>Loading...</div>; // small loading screen
  }

  return <>{session ? <ChatBox /> : <AuthForm />}</>;
}

export default App;
