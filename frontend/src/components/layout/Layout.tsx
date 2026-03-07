import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

interface LayoutProps {
  mint: string;
  onMintChange: (mint: string) => void;
  wsConnected: boolean;
}

export function Layout({ mint, onMintChange, wsConnected }: LayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <Header mint={mint} onMintChange={onMintChange} wsConnected={wsConnected} />
        <main className="flex-1 overflow-auto p-5 animate-fade-in">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
