import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";

// Временная заглушка: маршруты и провайдеры появятся в задаче 2 переноса.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div />
  </StrictMode>,
);
