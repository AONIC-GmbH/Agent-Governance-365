import { createRoot } from "react-dom/client";
import { PublicClientApplication } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import App from "./App.tsx";
import "./index.css";
import { isEntraMode } from "./lib/authMode";
import { msalConfig } from "./lib/msalConfig";
import { syncAuthSession } from "./services/coeService";

const root = createRoot(document.getElementById("root")!);

async function bootstrap() {
  if (!isEntraMode) {
    root.render(<App />);
    return;
  }

  const msalInstance = new PublicClientApplication(msalConfig);
  await msalInstance.initialize();

  try {
    const response = await msalInstance.handleRedirectPromise();
    if (response?.account) {
      msalInstance.setActiveAccount(response.account);
      if (response.idToken) {
        await syncAuthSession(response.idToken);
      }
    } else {
      const accounts = msalInstance.getAllAccounts();
      if (accounts.length > 0) {
        msalInstance.setActiveAccount(accounts[0]);
      }
    }
  } catch (e) {
    console.error("MSAL redirect handling failed:", e);
  }

  root.render(
    <MsalProvider instance={msalInstance}>
      <App />
    </MsalProvider>
  );
}

bootstrap();
