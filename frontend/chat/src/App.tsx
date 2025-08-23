import { useEffect, useState } from "react";
import { supabase } from "./services/supabaseClient";

import "./App.css";
import AuthForm from "./pages/AuthForm";
import ChatBox from "./pages/ChatBox";

function App() {
  const [session, setSession] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {

    

    supabase.auth.getSession().then(({ data }) => {

      setSession(data.session);

      setAuthReady(true);

    });

    

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {

      setSession(newSession);

    });


    
    return () => subscription.unsubscribe();


  }, []);

  if (!authReady) {
    return <div>Loading...</div>; 
  }

  return <>{session ? <ChatBox /> : <AuthForm />}</>;
}

export default App;
