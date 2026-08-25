import { setTheme as setNativeTheme } from "@tauri-apps/api/app";

export interface ThemeDefinition {
  id: string;
  name: string;
  colors: {
    background: string;
    elevated: string;
    hover: string;
    border: string;
    text: string;
    textMuted: string;
    accent: string;
    accentSecondary: string;
    success: string;
    danger: string;
    overlay: string;
  };
}

const registry = new Map<string, ThemeDefinition>();

export function registerTheme(theme: ThemeDefinition): void {
  registry.set(theme.id, theme);
}

registerTheme({
  id: "kanagawa-wave",
  name: "Kanagawa Wave",
  colors: {
    background: "#1f1f28",
    elevated: "#2a2a37",
    hover: "#363646",
    border: "rgba(126, 156, 216, 0.22)",
    text: "#dcd7ba",
    textMuted: "#727169",
    accent: "#7e9cd8",
    accentSecondary: "#957fb8",
    success: "#98bb6c",
    danger: "#e46876",
    overlay: "rgba(31, 31, 40, 0.92)",
  },
});

registerTheme({
  id: "kanagawa-dragon",
  name: "Kanagawa Dragon",
  colors: {
    background: "#181616",
    elevated: "#282727",
    hover: "#393836",
    border: "rgba(192, 163, 110, 0.2)",
    text: "#c5c9c5",
    textMuted: "#737c73",
    accent: "#8ba4b0",
    accentSecondary: "#a292a3",
    success: "#87a987",
    danger: "#c4746e",
    overlay: "rgba(24, 22, 22, 0.94)",
  },
});

interface PaletteTheme {
  id: string;
  name: string;
  background: string;
  elevated: string;
  hover: string;
  text: string;
  textMuted: string;
  accent: string;
  accentSecondary: string;
  success: string;
  danger: string;
}

function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function registerPaletteTheme(theme: PaletteTheme): void {
  registerTheme({
    id: theme.id,
    name: theme.name,
    colors: {
      background: theme.background,
      elevated: theme.elevated,
      hover: theme.hover,
      border: withAlpha(theme.textMuted, 0.28),
      text: theme.text,
      textMuted: theme.textMuted,
      accent: theme.accent,
      accentSecondary: theme.accentSecondary,
      success: theme.success,
      danger: theme.danger,
      overlay: withAlpha(theme.background, 0.94),
    },
  });
}

[
  {
    id: "tokyonight-night", name: "Tokyo Night · Night",
    background: "#1a1b26", elevated: "#24283b", hover: "#292e42",
    text: "#c0caf5", textMuted: "#737aa2", accent: "#7aa2f7",
    accentSecondary: "#bb9af7", success: "#9ece6a", danger: "#f7768e",
  },
  {
    id: "tokyonight-storm", name: "Tokyo Night · Storm",
    background: "#24283b", elevated: "#292e42", hover: "#3b4261",
    text: "#c0caf5", textMuted: "#737aa2", accent: "#7aa2f7",
    accentSecondary: "#bb9af7", success: "#9ece6a", danger: "#f7768e",
  },
  {
    id: "tokyonight-day", name: "Tokyo Night · Day",
    background: "#e1e2e7", elevated: "#d0d5e3", hover: "#c4c8da",
    text: "#3760bf", textMuted: "#6172b0", accent: "#2e7de9",
    accentSecondary: "#9854f1", success: "#587539", danger: "#f52a65",
  },
  {
    id: "tokyonight-moon", name: "Tokyo Night · Moon",
    background: "#222436", elevated: "#2f334d", hover: "#444a73",
    text: "#c8d3f5", textMuted: "#828bb8", accent: "#82aaff",
    accentSecondary: "#c099ff", success: "#c3e88d", danger: "#ff757f",
  },
  {
    id: "gruvbox-dark-hard", name: "Gruvbox · Dark Hard",
    background: "#1d2021", elevated: "#3c3836", hover: "#504945",
    text: "#ebdbb2", textMuted: "#928374", accent: "#83a598",
    accentSecondary: "#d3869b", success: "#b8bb26", danger: "#fb4934",
  },
  {
    id: "gruvbox-dark-medium", name: "Gruvbox · Dark Medium",
    background: "#282828", elevated: "#3c3836", hover: "#504945",
    text: "#ebdbb2", textMuted: "#928374", accent: "#83a598",
    accentSecondary: "#d3869b", success: "#b8bb26", danger: "#fb4934",
  },
  {
    id: "gruvbox-dark-soft", name: "Gruvbox · Dark Soft",
    background: "#32302f", elevated: "#3c3836", hover: "#504945",
    text: "#ebdbb2", textMuted: "#928374", accent: "#83a598",
    accentSecondary: "#d3869b", success: "#b8bb26", danger: "#fb4934",
  },
  {
    id: "gruvbox-light-hard", name: "Gruvbox · Light Hard",
    background: "#f9f5d7", elevated: "#ebdbb2", hover: "#d5c4a1",
    text: "#3c3836", textMuted: "#928374", accent: "#076678",
    accentSecondary: "#8f3f71", success: "#79740e", danger: "#9d0006",
  },
  {
    id: "gruvbox-light-medium", name: "Gruvbox · Light Medium",
    background: "#fbf1c7", elevated: "#ebdbb2", hover: "#d5c4a1",
    text: "#3c3836", textMuted: "#928374", accent: "#076678",
    accentSecondary: "#8f3f71", success: "#79740e", danger: "#9d0006",
  },
  {
    id: "gruvbox-light-soft", name: "Gruvbox · Light Soft",
    background: "#f2e5bc", elevated: "#ebdbb2", hover: "#d5c4a1",
    text: "#3c3836", textMuted: "#928374", accent: "#076678",
    accentSecondary: "#8f3f71", success: "#79740e", danger: "#9d0006",
  },
  {
    id: "dracula-classic", name: "Dracula · Classic",
    background: "#282a36", elevated: "#343746", hover: "#44475a",
    text: "#f8f8f2", textMuted: "#6272a4", accent: "#bd93f9",
    accentSecondary: "#8be9fd", success: "#50fa7b", danger: "#ff5555",
  },
  {
    id: "dracula-alucard", name: "Dracula · Alucard",
    background: "#fffbeb", elevated: "#efeddc", hover: "#dedccf",
    text: "#1f1f1f", textMuted: "#6c664b", accent: "#644ac9",
    accentSecondary: "#036a96", success: "#14710a", danger: "#cb3a2a",
  },
  {
    id: "catppuccin-latte", name: "Catppuccin · Latte",
    background: "#eff1f5", elevated: "#e6e9ef", hover: "#ccd0da",
    text: "#4c4f69", textMuted: "#6c6f85", accent: "#1e66f5",
    accentSecondary: "#8839ef", success: "#40a02b", danger: "#d20f39",
  },
  {
    id: "catppuccin-frappe", name: "Catppuccin · Frappé",
    background: "#303446", elevated: "#414559", hover: "#51576d",
    text: "#c6d0f5", textMuted: "#a5adce", accent: "#8caaee",
    accentSecondary: "#ca9ee6", success: "#a6d189", danger: "#e78284",
  },
  {
    id: "catppuccin-macchiato", name: "Catppuccin · Macchiato",
    background: "#24273a", elevated: "#363a4f", hover: "#494d64",
    text: "#cad3f5", textMuted: "#a5adcb", accent: "#8aadf4",
    accentSecondary: "#c6a0f6", success: "#a6da95", danger: "#ed8796",
  },
  {
    id: "catppuccin-mocha", name: "Catppuccin · Mocha",
    background: "#1e1e2e", elevated: "#313244", hover: "#45475a",
    text: "#cdd6f4", textMuted: "#a6adc8", accent: "#89b4fa",
    accentSecondary: "#cba6f7", success: "#a6e3a1", danger: "#f38ba8",
  },
].forEach(registerPaletteTheme);

export function availableThemes(): ThemeDefinition[] {
  return [...registry.values()];
}

export function applyTheme(id: string): ThemeDefinition {
  const theme = registry.get(id) ?? registry.get("kanagawa-wave")!;
  const root = document.documentElement;
  const { colors } = theme;

  root.dataset.theme = theme.id;
  root.style.setProperty("--bg", colors.background);
  root.style.setProperty("--bg-elev", colors.elevated);
  root.style.setProperty("--bg-hover", colors.hover);
  root.style.setProperty("--border", colors.border);
  root.style.setProperty("--text", colors.text);
  root.style.setProperty("--text-dim", colors.textMuted);
  root.style.setProperty("--accent", colors.accent);
  root.style.setProperty("--accent-2", colors.accentSecondary);
  root.style.setProperty("--success", colors.success);
  root.style.setProperty("--danger", colors.danger);
  root.style.setProperty("--overlay", colors.overlay);
  const background = Number.parseInt(colors.background.slice(1), 16);
  const red = background >> 16;
  const green = (background >> 8) & 255;
  const blue = background & 255;
  const tone = 0.2126 * red + 0.7152 * green + 0.0722 * blue > 150 ? "light" : "dark";
  root.style.colorScheme = tone;
  root.style.setProperty(
    "--shadow",
    tone === "light" ? withAlpha(colors.text, 0.18) : "rgba(0, 0, 0, 0.42)",
  );
  root.style.setProperty(
    "--scrim",
    tone === "light" ? withAlpha(colors.text, 0.24) : "rgba(0, 0, 0, 0.5)",
  );
  void setNativeTheme(tone).catch(() => {
    // The web-only design-system page has no native Tauri window to update.
  });
  localStorage.setItem("spotagooey.theme", theme.id);
  return theme;
}

export function initialTheme(): ThemeDefinition {
  return applyTheme(localStorage.getItem("spotagooey.theme") ?? "kanagawa-wave");
}
