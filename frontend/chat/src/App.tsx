import { useEffect, useState } from 'react'
import { supabase } from './services/supabaseClient';

import './App.css'
import AuthForm from './pages/AuthForm'

import ChatBox from "./pages/ChatBox"

function App() {

  const [session,setSession] = useState<any>(null);

  const fetchSession = async () => {
    const currentSession = await supabase.auth.getSession();
    console.log(currentSession);
    
    setSession(currentSession.data.session);
  };

  useEffect(() => {

    fetchSession();

    
  }, []);
  

  return (
    <>

    {
      session ? 

      <ChatBox/> :

      <AuthForm/>


    }

    

    
    
    </>
  )
}

export default App



