import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ReviewPage } from "./ReviewPage";
import { InboxPage } from "./InboxPage";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{window.location.pathname.startsWith("/review/") ? <ReviewPage /> : <InboxPage />}</StrictMode>,
);