require("dotenv").config();
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");

const tenantId = process.env.ENTRA_TENANT_ID;
const clientId = process.env.ENTRA_CLIENT_ID;
const authEnabled =
  Boolean(tenantId && clientId) &&
  !String(tenantId).startsWith("your-") &&
  !String(clientId).startsWith("your-");

const issuers = tenantId
  ? [
      `https://login.microsoftonline.com/${tenantId}/v2.0`,
      `https://sts.windows.net/${tenantId}/`,
    ]
  : [];

const jwks = authEnabled
  ? jwksClient({
      jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
      cache: true,
      rateLimit: true,
    })
  : null;

function getSigningKey(header, callback) {
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

function verifyToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getSigningKey,
      {
        audience: clientId,
        issuer: issuers,
        algorithms: ["RS256"],
        clockTolerance: 60,
      },
      (err, decoded) => (err ? reject(err) : resolve(decoded))
    );
  });
}

async function optionalAuth(req, _res, next) {
  if (!authEnabled) return next();
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next();
  try {
    req.user = await verifyToken(header.slice(7));
    next();
  } catch {
    next();
  }
}

async function requireAuth(req, res, next) {
  if (!authEnabled) return next();
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authorization required" });
  }
  try {
    req.user = await verifyToken(header.slice(7));
    next();
  } catch (err) {
    console.error("Token verification failed:", err.message);
    return res.status(401).json({ error: "Invalid token" });
  }
}

function claimsFromUser(user) {
  return {
    id: user.oid || user.sub,
    email: user.preferred_username || user.email || user.upn || "",
    full_name: user.name || user.preferred_username || "User",
  };
}

module.exports = { optionalAuth, requireAuth, claimsFromUser, authEnabled };
