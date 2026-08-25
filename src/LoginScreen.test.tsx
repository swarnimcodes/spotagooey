// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppInfo } from "./api";
import { LoginScreen } from "./App";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

afterEach(cleanup);

const info: AppInfo = {
  clientIdSet: true,
  redirectUri: "http://127.0.0.1:8431/callback",
  configPath: "/home/example/.config/spotagooey/client.yml",
};

describe("LoginScreen", () => {
  it("shows browser guidance and prevents another login while authorization is pending", () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    const onSaveClientId = vi.fn().mockResolvedValue(undefined);

    render(
      <LoginScreen
        info={info}
        loginPending
        onLogin={onLogin}
        onSaveClientId={onSaveClientId}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Finish signing in through your browser");
    expect(screen.getByText(/other windows or browser tabs/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Continue with Spotify" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change Client ID" })).not.toBeInTheDocument();
    expect(onLogin).not.toHaveBeenCalled();
    expect(onSaveClientId).not.toHaveBeenCalled();
  });
});
