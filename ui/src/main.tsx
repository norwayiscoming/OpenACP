import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ThemeProvider } from "./contexts/theme-context";
import { EventStreamProvider } from "./contexts/event-stream-context";
import { App } from "./App";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <EventStreamProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </EventStreamProvider>
    </BrowserRouter>
  </StrictMode>,
);
