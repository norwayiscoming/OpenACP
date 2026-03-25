import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";
type EventHandler = (data: unknown) => void;

interface EventStreamContextValue {
  status: ConnectionStatus;
  subscribe: (event: string, handler: EventHandler) => () => void;
}

const EventStreamContext = createContext<EventStreamContextValue>({
  status: "disconnected",
  subscribe: () => () => {},
});

export function EventStreamProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const sourceRef = useRef<EventSource | null>(null);
  const handlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  const retryRef = useRef(1000);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const subscribe = useCallback((event: string, handler: EventHandler) => {
    if (!handlersRef.current.has(event)) {
      handlersRef.current.set(event, new Set());
    }
    handlersRef.current.get(event)!.add(handler);
    return () => {
      handlersRef.current.get(event)?.delete(handler);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const token = sessionStorage.getItem("openacp-token");
      const params = new URLSearchParams();
      if (token) params.set("token", token);
      const qs = params.toString();
      const url = `/api/events${qs ? `?${qs}` : ""}`;

      setStatus("connecting");
      const source = new EventSource(url);
      sourceRef.current = source;

      source.onopen = () => {
        if (cancelled) return;
        setStatus("connected");
        retryRef.current = 1000;
      };

      source.onerror = () => {
        if (cancelled) return;
        source.close();
        sourceRef.current = null;
        setStatus("disconnected");
        const delay = Math.min(retryRef.current, 30000);
        retryRef.current = delay * 2;
        retryTimeoutRef.current = setTimeout(connect, delay);
      };

      const events = [
        "session:created",
        "session:updated",
        "session:deleted",
        "agent:event",
        "permission:request",
        "health",
      ];
      for (const eventName of events) {
        source.addEventListener(eventName, (e: MessageEvent) => {
          try {
            const data: unknown = JSON.parse(e.data as string);
            const handlers = handlersRef.current.get(eventName);
            if (handlers) {
              for (const handler of handlers) handler(data);
            }
          } catch {
            /* ignore parse errors */
          }
        });
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  return (
    <EventStreamContext value={{ status, subscribe }}>
      {children}
    </EventStreamContext>
  );
}

export function useEventStream() {
  return useContext(EventStreamContext);
}
