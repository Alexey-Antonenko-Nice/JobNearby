import { TodayPage } from "./TodayPage";
import { ContactsPage } from "./ContactsPage";
import { DocumentLibraryPage } from "./DocumentLibraryPage";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ReviewPage } from "./ReviewPage";
import { InboxPage } from "./InboxPage";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{window.location.pathname === "/today" ? <TodayPage /> : window.location.pathname === "/contacts" ? <ContactsPage /> : window.location.pathname === "/documents" ? <DocumentLibraryPage /> : window.location.pathname.startsWith("/review/") ? <ReviewPage /> : <InboxPage />}</StrictMode>,
);