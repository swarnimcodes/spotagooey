import React from "react";
import ReactDOM from "react-dom/client";
import { initialTheme } from "./themes";

initialTheme();

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
const designSystemPath = window.location.pathname.replace(/\/$/, "") === "/design-system";

const module = designSystemPath ? await import("./DesignSystem") : await import("./App");
const Root = module.default;

root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
