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
  localStorage.setItem("spotagooey.theme", theme.id);
  return theme;
}

export function initialTheme(): ThemeDefinition {
  return applyTheme(localStorage.getItem("spotagooey.theme") ?? "kanagawa-wave");
}
