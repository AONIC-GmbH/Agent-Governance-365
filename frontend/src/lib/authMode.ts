export const isMockMode = import.meta.env.VITE_MOCK_MODE === "true";

/** Microsoft Entra ID (MSAL) when client ID is configured and mock mode is off */
export const isEntraMode =
  !isMockMode && Boolean(import.meta.env.VITE_ENTRA_CLIENT_ID?.trim());
