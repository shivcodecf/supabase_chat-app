
import jwt from "jsonwebtoken";


export function validateJWT(req, res, next) {

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;

    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    
    const payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET, {
      algorithms: ["HS256"],
    });

    

    req.user = {

      id: payload.sub,
      email: payload.email,
      role: payload.role,
      raw: payload, 

    };

    return next();

  } catch (err) {
    
    console.error("JWT verify failed:", err?.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
