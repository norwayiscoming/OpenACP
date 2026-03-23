import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { useEventStream } from "../../contexts/event-stream-context";

export function Layout() {
  const { status } = useEventStream();

  return (
    <div className="flex h-screen w-full relative overflow-hidden">
      <Sidebar connectionStatus={status} />
      <div className="flex flex-col flex-1 relative z-10 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-6 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
