import { useState, type CSSProperties } from "react";
import { applyTheme, availableThemes } from "./themes";
import { ThemedSelect } from "./components/ThemedSelect";
import "./DesignSystem.css";

const tracks = [
  { title: "A Walk Through Pines", artist: "Mira Vale", duration: "3:42" },
  { title: "Still Water", artist: "North Window", duration: "4:08" },
  { title: "After the Rain", artist: "Mira Vale", duration: "2:57" },
];

function Glyph({ children }: { children: string }) {
  return <span aria-hidden="true">{children}</span>;
}

function Artwork({ tone, label }: { tone: "blue" | "plum" | "sand"; label: string }) {
  return (
    <div className={`ds-artwork ${tone}`} role="img" aria-label={label}>
      <span />
      <i />
    </div>
  );
}

export default function DesignSystem() {
  const themes = availableThemes();
  const [themeId, setThemeId] = useState(
    () => document.documentElement.dataset.theme ?? "kanagawa-wave",
  );
  const [playing, setPlaying] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [segment, setSegment] = useState("Albums");
  const [device, setDevice] = useState("laptop");
  const [volume, setVolume] = useState(64);
  const activeTheme = themes.find((theme) => theme.id === themeId) ?? themes[0];
  const swatches = [
    ["canvas", "Canvas", activeTheme.colors.background],
    ["surface", "Surface", activeTheme.colors.elevated],
    ["text", "Text", activeTheme.colors.text],
    ["muted", "Muted", activeTheme.colors.textMuted],
    ["accent", "Accent", activeTheme.colors.accent],
    ["danger", "Danger", activeTheme.colors.danger],
  ];

  const changeTheme = (id: string) => {
    applyTheme(id);
    setThemeId(id);
  };

  return (
    <div className="ds-page">
      <header className="ds-masthead">
        <div className="ds-wordmark"><span>♪</span> Spotagooey</div>
        <div className="ds-masthead-actions">
          <ThemedSelect
            compact
            label="Theme"
            value={themeId}
            options={themes.map((theme) => ({ value: theme.id, label: theme.name }))}
            onValueChange={changeTheme}
          />
          <div className="ds-version">Interface standard · v1</div>
        </div>
      </header>

      <main className="ds-main">
        <section className="ds-intro">
          <p className="ds-kicker">Design language</p>
          <h1>Quiet, musical, and deliberate.</h1>
          <p className="ds-lede">
            Content provides the character. Interface elements provide structure. Decoration never
            competes with either.
          </p>
        </section>

        <section className="ds-principles" aria-label="Design principles">
          <article><b>01</b><h3>Content first</h3><p>Artwork, titles, and listening context lead every screen.</p></article>
          <article><b>02</b><h3>Quiet surfaces</h3><p>Tonal layers and fine borders replace gradients and colored glow.</p></article>
          <article><b>03</b><h3>Honest depth</h3><p>Shadow appears only when an element physically floats above another.</p></article>
          <article><b>04</b><h3>Measured accent</h3><p>Accent color communicates action, selection, and progress—nothing else.</p></article>
        </section>

        <section className="ds-section">
          <div className="ds-section-head"><span>01</span><div><h2>Foundations</h2><p>The small set of decisions every component inherits.</p></div></div>
          <div className="ds-foundation-grid">
            <article className="ds-specimen">
              <h3>Color roles</h3>
              <div className="ds-swatches">
                {swatches.map(([role, label, color]) => (
                  <div key={role}><i className={`swatch ${role}`} /><span>{label}</span><code>{color.toUpperCase()}</code></div>
                ))}
              </div>
            </article>

            <article className="ds-specimen ds-type-specimen">
              <h3>Type scale</h3>
              <p className="type-display">Library</p>
              <p className="type-title">Recently added</p>
              <p className="type-body">A calm system face keeps the interface familiar.</p>
              <p className="type-meta">MIRA VALE · 2026</p>
            </article>

            <article className="ds-specimen">
              <h3>Shape & spacing</h3>
              <div className="ds-measures">
                <div><span style={{ "--measure": "8px" } as CSSProperties} /><code>8</code></div>
                <div><span style={{ "--measure": "16px" } as CSSProperties} /><code>16</code></div>
                <div><span style={{ "--measure": "24px" } as CSSProperties} /><code>24</code></div>
                <div><span style={{ "--measure": "32px" } as CSSProperties} /><code>32</code></div>
              </div>
              <p className="ds-rule">8px rhythm · 10px controls · 16px panels</p>
            </article>
          </div>
        </section>

        <section className="ds-section">
          <div className="ds-section-head"><span>02</span><div><h2>Controls</h2><p>Clear state changes without visual theatre.</p></div></div>
          <div className="ds-component-grid">
            <article className="ds-specimen ds-wide">
              <h3>Buttons</h3>
              <div className="ds-row">
                <button className="ds-button primary">Play album</button>
                <button className="ds-button secondary">Add to library</button>
                <button className="ds-button quiet">View artist</button>
                <button className="ds-icon-button" aria-label="More options">•••</button>
                <button className="ds-button primary" disabled>Unavailable</button>
              </div>
            </article>

            <article className="ds-specimen">
              <h3>Fields</h3>
              <label className="ds-label">Search</label>
              <div className="ds-search"><Glyph>⌕</Glyph><input placeholder="Artists, albums, and songs" /></div>
              <div className="ds-select-field">
                <ThemedSelect
                  label="Device"
                  value={device}
                  options={[
                    { value: "laptop", label: "Laptop" },
                    { value: "living-room", label: "Living room" },
                  ]}
                  onValueChange={setDevice}
                />
              </div>
            </article>

            <article className="ds-specimen">
              <h3>Selection</h3>
              <div className="ds-segmented" aria-label="Library view">
                {["Albums", "Artists", "Songs"].map((item) => (
                  <button key={item} className={segment === item ? "active" : ""} onClick={() => setSegment(item)}>{item}</button>
                ))}
              </div>
              <label className="ds-switch-row">
                <span><b>Autoplay</b><small>Continue with related music</small></span>
                <button className={`ds-switch ${enabled ? "on" : ""}`} role="switch" aria-checked={enabled} onClick={() => setEnabled(!enabled)}><i /></button>
              </label>
            </article>
          </div>
        </section>

        <section className="ds-section">
          <div className="ds-section-head"><span>03</span><div><h2>Music components</h2><p>Artwork and metadata remain the strongest visual elements.</p></div></div>
          <div className="ds-music-grid">
            <article className="ds-specimen">
              <div className="ds-card-head"><h3>Album cards</h3><button>See all</button></div>
              <div className="ds-album-grid">
                <div className="ds-album-card"><Artwork tone="blue" label="Blue abstract album artwork" /><b>Still Water</b><span>North Window</span></div>
                <div className="ds-album-card"><Artwork tone="plum" label="Plum abstract album artwork" /><b>Low Light</b><span>Mira Vale</span></div>
                <div className="ds-album-card"><Artwork tone="sand" label="Sand abstract album artwork" /><b>Open Country</b><span>Field Notes</span></div>
              </div>
            </article>

            <article className="ds-specimen">
              <div className="ds-card-head"><h3>Track list</h3><span>3 songs</span></div>
              <div className="ds-track-list">
                {tracks.map((track, index) => (
                  <button className={`ds-track ${index === 0 ? "active" : ""}`} key={track.title}>
                    <span className="ds-track-index">{index === 0 ? "▶" : index + 1}</span>
                    <span><b>{track.title}</b><small>{track.artist}</small></span>
                    <time>{track.duration}</time>
                    <i>•••</i>
                  </button>
                ))}
              </div>
            </article>
          </div>
        </section>

        <section className="ds-section">
          <div className="ds-section-head"><span>04</span><div><h2>Playback & feedback</h2><p>Persistent controls, transient messages, and empty states.</p></div></div>
          <div className="ds-specimen ds-player-specimen">
            <div className="ds-now-track"><Artwork tone="blue" label="Current album artwork" /><span><b>A Walk Through Pines</b><small>Mira Vale</small></span></div>
            <div className="ds-transport">
              <div><button aria-label="Previous">‹</button><button className="play" aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying(!playing)}>{playing ? "Ⅱ" : "▶"}</button><button aria-label="Next">›</button></div>
              <div className="ds-progress"><span>1:18</span><i><b /></i><span>3:42</span></div>
            </div>
            <div className="ds-volume"><Glyph>◖</Glyph><input aria-label="Volume" type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></div>
          </div>
          <div className="ds-feedback-grid">
            <div className="ds-toast"><span className="success">✓</span><div><b>Added to library</b><small>Still Water · North Window</small></div><button>×</button></div>
            <div className="ds-empty"><span>♪</span><div><b>No saved albums yet</b><small>Albums you save will appear here.</small></div><button className="ds-button secondary">Browse music</button></div>
          </div>
        </section>

        <section className="ds-guardrails">
          <h2>Guardrails</h2>
          <div><p><b>Use</b> tonal contrast, whitespace, fine borders, direct labels, restrained motion.</p><p><b>Avoid</b> ambient glow, decorative gradients, glass everywhere, pill-shaped everything, and motion without meaning.</p></div>
        </section>
      </main>
    </div>
  );
}
