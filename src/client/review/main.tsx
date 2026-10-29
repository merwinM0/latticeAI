import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Review } from "./Review";
import "./review.css";
createRoot(document.getElementById("root")!).render(<StrictMode><Review/></StrictMode>);
