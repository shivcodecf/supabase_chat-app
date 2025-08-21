// src/middleware.js
import jwt from "jsonwebtoken";

/**
 * Validates a Supabase JWT from the Authorization header.
 * Requires SUPABASE_JWT_SECRET in your .env (find it in Supabase → Settings → API).
 */
export function validateJWT(req, res, next) {
  
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;

    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    // Verify using your project's JWT secret (HS256)
    const payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET, {
      algorithms: ["HS256"],
    });

    // Attach minimal user info for downstream handlers

    req.user = {

      id: payload.sub,
      email: payload.email,
      role: payload.role,
      raw: payload, // optional, remove if you don't want it

    };

    return next();

  } catch (err) {
    // Helpful logs during setup; remove in production
    console.error("JWT verify failed:", err?.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
