// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemedSelect } from "./ThemedSelect";

afterEach(cleanup);

describe("ThemedSelect", () => {
  it("exposes an accessible themed popup and reports selections", async () => {
    const onValueChange = vi.fn();
    render(
      <ThemedSelect
        label="Appearance"
        value="wave"
        options={[
          { value: "wave", label: "Kanagawa Wave" },
          { value: "latte", label: "Catppuccin Latte" },
        ]}
        onValueChange={onValueChange}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Appearance" });
    expect(trigger).toHaveTextContent("Kanagawa Wave");

    fireEvent.click(trigger);
    const option = await screen.findByRole("option", { name: "Catppuccin Latte" });
    fireEvent.pointerDown(option, { button: 0 });
    fireEvent.pointerUp(option, { button: 0 });
    fireEvent.click(option);

    expect(onValueChange).toHaveBeenCalledWith("latte");
  });
});
