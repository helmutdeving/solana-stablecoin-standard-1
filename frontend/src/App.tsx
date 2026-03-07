import { useState } from "react";
import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Operations } from "./pages/Operations";
import { Compliance } from "./pages/Compliance";
import { Events } from "./pages/Events";
import { Oracle } from "./pages/Oracle";
import { Settings } from "./pages/Settings";
import { useWebSocket } from "./hooks/useWebSocket";

// Default to devnet USDC for demo purposes
const DEFAULT_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export default function App() {
  const [mint, setMint] = useState<string>(
    localStorage.getItem("sss_active_mint") ?? DEFAULT_MINT,
  );

  const handleMintChange = (newMint: string) => {
    setMint(newMint);
    localStorage.setItem("sss_active_mint", newMint);
  };

  const { events, connected, reconnecting } = useWebSocket({ mint });

  return (
    <Routes>
      <Route
        element={
          <Layout
            mint={mint}
            onMintChange={handleMintChange}
            wsConnected={connected}
          />
        }
      >
        <Route
          index
          element={<Dashboard mint={mint} events={events} />}
        />
        <Route path="operations" element={<Operations mint={mint} />} />
        <Route path="compliance" element={<Compliance mint={mint} />} />
        <Route
          path="events"
          element={
            <Events
              events={events}
              wsConnected={connected}
              wsReconnecting={reconnecting}
            />
          }
        />
        <Route path="oracle" element={<Oracle />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
