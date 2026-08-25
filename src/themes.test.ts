import { describe, expect, it } from "vitest";
import { availableThemes } from "./themes";

describe("built-in themes", () => {
  it("registers every supported official palette variant with unique IDs", () => {
    const themes = availableThemes();
    const ids = themes.map((theme) => theme.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      "tokyonight-night",
      "tokyonight-storm",
      "tokyonight-day",
      "tokyonight-moon",
      "gruvbox-dark-hard",
      "gruvbox-dark-medium",
      "gruvbox-dark-soft",
      "gruvbox-light-hard",
      "gruvbox-light-medium",
      "gruvbox-light-soft",
      "dracula-classic",
      "dracula-alucard",
      "catppuccin-latte",
      "catppuccin-frappe",
      "catppuccin-macchiato",
      "catppuccin-mocha",
    ]));
  });

  it("keeps each family anchored to its canonical background colors", () => {
    const backgrounds = Object.fromEntries(
      availableThemes().map((theme) => [theme.id, theme.colors.background]),
    );

    expect(backgrounds).toMatchObject({
      "tokyonight-night": "#1a1b26",
      "tokyonight-storm": "#24283b",
      "tokyonight-day": "#e1e2e7",
      "tokyonight-moon": "#222436",
      "gruvbox-dark-hard": "#1d2021",
      "gruvbox-dark-medium": "#282828",
      "gruvbox-dark-soft": "#32302f",
      "gruvbox-light-hard": "#f9f5d7",
      "gruvbox-light-medium": "#fbf1c7",
      "gruvbox-light-soft": "#f2e5bc",
      "dracula-classic": "#282a36",
      "dracula-alucard": "#fffbeb",
      "catppuccin-latte": "#eff1f5",
      "catppuccin-frappe": "#303446",
      "catppuccin-macchiato": "#24273a",
      "catppuccin-mocha": "#1e1e2e",
    });
  });
});
