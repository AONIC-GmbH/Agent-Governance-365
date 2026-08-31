import type { Configuration } from "@azure/msal-browser";
import { LogLevel } from "@azure/msal-browser";

const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID ?? "common";
const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID ?? "";

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: typeof window !== "undefined" ? window.location.origin : undefined,
    postLogoutRedirectUri: typeof window !== "undefined" ? window.location.origin : undefined,
  },
  cache: {
    cacheLocation: "sessionStorage",
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
    },
  },
};

/** Scopes for sign-in — keep minimal so silent token renewal works without extra popups */
export const loginRequest = {
  scopes: ["openid", "profile", "email"],
};

export const entraApiScope = import.meta.env.VITE_ENTRA_API_SCOPE?.trim();

export function getTokenRequest() {
  return entraApiScope ? { scopes: [entraApiScope] } : loginRequest;
}
