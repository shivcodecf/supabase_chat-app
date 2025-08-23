import { useState } from "react";
import { supabase } from "../services/supabaseClient";

export default function AuthForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const signUp = async () => {
    if (!email || !password) {
      alert("Email and password are required");
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    if (error) {
      alert("Error: " + error.message);
    } else {
      alert("Signup success! Check your email for confirmation.");
      console.log("User:", data.user);
    }
  };

  const signIn = async () => {
    if (!email || !password) {
      alert("Email and password are required");
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      alert("Error: " + error.message);
    } else {
      alert("Signed in successfully!");
      console.log("User:", data.user);
    }
  };

  return (
    <div
      style={{ maxWidth: 360, margin: "10vh auto", display: "grid", gap: 8 }}
    >
      <h2>Login / Signup</h2>

      <input
        type="email"
        placeholder="Enter email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <input
        type="password"
        placeholder="Enter password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <button onClick={signIn}>Sign In</button>
      <button onClick={signUp}>Sign Up</button>
    </div>
  );
}
