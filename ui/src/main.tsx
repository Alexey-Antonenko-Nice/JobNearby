import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ReviewPage } from "./ReviewPage";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><ReviewPage /></StrictMode>,
);