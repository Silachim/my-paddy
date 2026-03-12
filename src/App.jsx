// App.jsx — THE JOURNAL — Rich Note Editor
// Features: text, images (upload/camera), freehand drawing, checklists,
//           bullet lists, tables, dividers, text formatting, voice, AI reflection
// No Capacitor dependencies — pure React + browser APIs

import { useState, useEffect, useRef, useCallback } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────
const MOODS = [
  { emoji: "🔥", label: "fired up" }, { emoji: "🌊", label: "flowing" },
  { emoji: "🌫️", label: "foggy" },   { emoji: "⚡", label: "electric" },
  { emoji: "🪨", label: "heavy" },   { emoji: "🌱", label: "growing" },
  { emoji: "😰", label: "anxious" }, { emoji: "🥳", label: "joyful" },
  { emoji: "😴", label: "tired" },   { emoji: "❤️", label: "grateful" },
];
const TAGS = ["work", "relationships", "body", "mind", "creativity", "fear", "gratitude", "dreams"];
const LANGUAGES = [
  { code: "en-US", label: "English" },
  { code: "fr-FR", label: "Français" },
  { code: "es-ES", label: "Español" },
  { code: "de-DE", label: "Deutsch" },
  { code: "it-IT", label: "Italiano" },
  { code: "pt-BR", label: "Português" },
  { code: "zh-CN", label: "中文" },
  { code: "ja-JP", label: "日本語" },
  { code: "ko-KR", label: "한국어" },
  { code: "ar-SA", label: "العربية" },
  { code: "hi-IN", label: "हिन्दी" },
  { code: "ru-RU", label: "Русский" },
  { code: "nl-NL", label: "Nederlands" },
  { code: "pl-PL", label: "Polski" },
  { code: "tr-TR", label: "Türkçe" },
  { code: "sv-SE", label: "Svenska" },
  { code: "yo-NG", label: "Yorùbá" },
  { code: "ig-NG", label: "Igbo" },
  { code: "ha-NG", label: "Hausa" },
  { code: "sw-KE", label: "Kiswahili" },
];
const STORAGE_KEY = "journal_entries_v2";
const PROXY_URL = "/api/reflect";
const ANTHROPIC_API_KEY = null;

// Block types
const BLOCK = {
  TEXT: "text", IMAGE: "image", DRAWING: "drawing",
  CHECKLIST: "checklist", BULLETS: "bullets",
  TABLE: "table", DIVIDER: "divider", HEADING: "heading", QUOTE: "quote",
};

// ── Storage ───────────────────────────────────────────────────────────────────
function loadEntries() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function persistEntries(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
}

// ── Claude API ────────────────────────────────────────────────────────────────
async function askClaude(text) {
  if (PROXY_URL) {
    try {
      const res = await fetch(PROXY_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryText: text }) });
      const d = await res.json();
      return d.reflection || "No reflection available.";
    } catch { return "Couldn't reach the AI — try again."; }
  }
  if (ANTHROPIC_API_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: "You are a warm, empathetic journaling assistant. Provide a brief (3-5 sentence) reflection on the journal entry, acknowledge emotions, offer an insight, and end with a gentle follow-up question.", messages: [{ role: "user", content: `Journal entry:\n\n${text}` }] }),
      });
      const d = await res.json();
      return d.content?.[0]?.text || "No reflection available.";
    } catch { return "Couldn't reach the AI."; }
  }
  return "Add your API key or proxy URL to enable AI reflections.";
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2); }
function formatDate(ts) { return new Date(ts).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }); }
function shortDate(ts) { return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase(); }
function makeBlock(type, data = {}) {
  const defaults = {
    [BLOCK.TEXT]: { text: "" },
    [BLOCK.HEADING]: { text: "", level: 2 },
    [BLOCK.QUOTE]: { text: "" },
    [BLOCK.IMAGE]: { src: null, caption: "" },
    [BLOCK.DRAWING]: { dataURL: null },
    [BLOCK.CHECKLIST]: { items: [{ id: uid(), text: "", checked: false }] },
    [BLOCK.BULLETS]: { items: [{ id: uid(), text: "" }] },
    [BLOCK.TABLE]: { rows: [["", ""], ["", ""]], cols: 2 },
    [BLOCK.DIVIDER]: {},
  };
  return { id: uid(), type, ...defaults[type], ...data };
}
function getPlainText(blocks) {
  return blocks.map(b => {
    if (b.type === BLOCK.TEXT || b.type === BLOCK.HEADING || b.type === BLOCK.QUOTE) return b.text;
    if (b.type === BLOCK.CHECKLIST) return b.items.map(i => i.text).join(" ");
    if (b.type === BLOCK.BULLETS) return b.items.map(i => i.text).join(" ");
    if (b.type === BLOCK.TABLE) return b.rows.flat().join(" ");
    return "";
  }).join(" ").trim();
}

// ── Drawing Canvas Component ──────────────────────────────────────────────────
function DrawingCanvas({ onSave, onCancel, initialDataURL }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState("pen"); // pen | eraser
  const [color, setColor] = useState("#e8ff00");
  const [size, setSize] = useState(3);
  const lastPos = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (initialDataURL) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = initialDataURL;
    }
  }, [initialDataURL]);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
  };

  const startDraw = (e) => {
    e.preventDefault();
    setDrawing(true);
    lastPos.current = getPos(e, canvasRef.current);
  };

  const draw = (e) => {
    e.preventDefault();
    if (!drawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = tool === "eraser" ? "#1a1a1a" : color;
    ctx.lineWidth = tool === "eraser" ? size * 6 : size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    lastPos.current = pos;
  };

  const endDraw = () => setDrawing(false);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const COLORS = ["#e8ff00", "#ffffff", "#ff3b3b", "#3baaff", "#3bff8a", "#ff8c3b", "#d93bff", "#ff3bd9"];

  return (
    <div style={{ background: "#0a0a0a", border: "1px solid #2e2e2e", padding: 16 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setTool("pen")} style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", letterSpacing: "0.1em", textTransform: "uppercase", padding: "6px 12px", background: tool === "pen" ? "#e8ff00" : "none", border: "1px solid #2e2e2e", color: tool === "pen" ? "#000" : "#888", cursor: "pointer" }}>Pen</button>
        <button onClick={() => setTool("eraser")} style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", letterSpacing: "0.1em", textTransform: "uppercase", padding: "6px 12px", background: tool === "eraser" ? "#e8ff00" : "none", border: "1px solid #2e2e2e", color: tool === "eraser" ? "#000" : "#888", cursor: "pointer" }}>Eraser</button>
        <div style={{ display: "flex", gap: 4 }}>
          {COLORS.map(c => <div key={c} onClick={() => { setTool("pen"); setColor(c); }} style={{ width: 18, height: 18, background: c, border: color === c && tool === "pen" ? "2px solid #fff" : "2px solid transparent", cursor: "pointer" }} />)}
        </div>
        <input type="range" min={1} max={20} value={size} onChange={e => setSize(+e.target.value)} style={{ width: 80, accentColor: "#e8ff00" }} />
        <button onClick={clearCanvas} style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", letterSpacing: "0.1em", textTransform: "uppercase", padding: "6px 12px", background: "none", border: "1px solid #2e2e2e", color: "#888", cursor: "pointer", marginLeft: "auto" }}>Clear</button>
      </div>
      <canvas
        ref={canvasRef} width={800} height={400}
        style={{ width: "100%", height: "auto", display: "block", cursor: tool === "eraser" ? "cell" : "crosshair", touchAction: "none" }}
        onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
        onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={() => onSave(canvasRef.current.toDataURL())} style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", letterSpacing: "0.14em", textTransform: "uppercase", padding: "10px 20px", background: "#e8ff00", border: "none", color: "#000", cursor: "pointer" }}>Save Drawing</button>
        <button onClick={onCancel} style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", letterSpacing: "0.14em", textTransform: "uppercase", padding: "10px 20px", background: "none", border: "1px solid #2e2e2e", color: "#888", cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );
}

// ── Block Renderer (view mode) ────────────────────────────────────────────────
function BlockViewer({ block }) {
  if (block.type === BLOCK.TEXT) return <p style={{ fontSize: "1.15rem", lineHeight: 1.85, fontWeight: 300, whiteSpace: "pre-wrap", marginBottom: 12 }}>{block.text}</p>;
  if (block.type === BLOCK.HEADING) {
    const sizes = { 1: "2rem", 2: "1.6rem", 3: "1.2rem" };
    return <p style={{ fontFamily: "var(--font-display)", fontSize: sizes[block.level] || "1.6rem", letterSpacing: "0.03em", marginBottom: 10, color: "var(--white)" }}>{block.text}</p>;
  }
  if (block.type === BLOCK.QUOTE) return (
    <blockquote style={{ borderLeft: "3px solid var(--accent)", paddingLeft: 20, fontStyle: "italic", fontSize: "1.15rem", lineHeight: 1.85, fontWeight: 300, color: "var(--white)", marginBottom: 16 }}>{block.text}</blockquote>
  );
  if (block.type === BLOCK.IMAGE) return block.src ? (
    <div style={{ marginBottom: 16 }}>
      <img src={block.src} alt={block.caption} style={{ width: "100%", display: "block", border: "1px solid var(--gray-2)" }} />
      {block.caption && <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--gray-4)", letterSpacing: "0.1em", marginTop: 6 }}>{block.caption.toUpperCase()}</p>}
    </div>
  ) : null;
  if (block.type === BLOCK.DRAWING) return block.dataURL ? (
    <div style={{ marginBottom: 16 }}>
      <img src={block.dataURL} alt="Drawing" style={{ width: "100%", display: "block", border: "1px solid var(--gray-2)" }} />
    </div>
  ) : null;
  if (block.type === BLOCK.CHECKLIST) return (
    <div style={{ marginBottom: 16 }}>
      {block.items.map(item => (
        <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{ width: 16, height: 16, border: `1px solid ${item.checked ? "var(--accent)" : "var(--gray-3)"}`, background: item.checked ? "var(--accent)" : "none", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {item.checked && <span style={{ color: "#000", fontSize: 10, fontWeight: "bold" }}>✓</span>}
          </div>
          <span style={{ fontSize: "1rem", fontWeight: 300, textDecoration: item.checked ? "line-through" : "none", color: item.checked ? "var(--gray-3)" : "var(--white)" }}>{item.text}</span>
        </div>
      ))}
    </div>
  );
  if (block.type === BLOCK.BULLETS) return (
    <ul style={{ marginBottom: 16, paddingLeft: 0, listStyle: "none" }}>
      {block.items.map(item => (
        <li key={item.id} style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6, fontSize: "1rem", fontWeight: 300 }}>
          <span style={{ color: "var(--accent)", fontSize: "0.7rem", flexShrink: 0 }}>◆</span>
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
  if (block.type === BLOCK.TABLE) return (
    <div style={{ marginBottom: 16, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {block.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} style={{ border: "1px solid var(--gray-2)", padding: "8px 12px", fontSize: "0.95rem", fontWeight: ri === 0 ? 400 : 300, fontFamily: ri === 0 ? "var(--font-mono)" : "var(--font-body)", fontSize: ri === 0 ? "0.65rem" : "0.95rem", letterSpacing: ri === 0 ? "0.1em" : 0, textTransform: ri === 0 ? "uppercase" : "none", color: ri === 0 ? "var(--accent)" : "var(--white)" }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  if (block.type === BLOCK.DIVIDER) return <div style={{ height: 1, background: "var(--gray-2)", margin: "20px 0" }} />;
  return null;
}

// ── Block Editor (edit mode) ──────────────────────────────────────────────────
function BlockEditor({ block, onChange, onDelete, onMoveUp, onMoveDown, onAddAfter }) {
  const [editingDrawing, setEditingDrawing] = useState(false);

  const updateBlock = (patch) => onChange({ ...block, ...patch });

  const updateItem = (items, idx, patch) => items.map((it, i) => i === idx ? { ...it, ...patch } : it);
  const addItem = (items) => [...items, { id: uid(), text: "", checked: false }];
  const removeItem = (items, idx) => items.length > 1 ? items.filter((_, i) => i !== idx) : items;

  const blockControls = (
    <div className="block-controls">
      <button onClick={onMoveUp} title="Move up">↑</button>
      <button onClick={onMoveDown} title="Move down">↓</button>
      <button onClick={onDelete} title="Delete block" style={{ color: "#ff3b3b" }}>✕</button>
    </div>
  );

  if (block.type === BLOCK.TEXT) return (
    <div className="block-wrap">
      {blockControls}
      <textarea className="block-textarea" value={block.text} onChange={e => updateBlock({ text: e.target.value })} placeholder="Write something..." rows={3} />
    </div>
  );

  if (block.type === BLOCK.HEADING) return (
    <div className="block-wrap">
      {blockControls}
      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        {[1, 2, 3].map(l => <button key={l} onClick={() => updateBlock({ level: l })} style={{ fontFamily: "var(--font-mono)", fontSize: "0.55rem", padding: "3px 8px", background: block.level === l ? "var(--accent)" : "none", border: "1px solid var(--gray-2)", color: block.level === l ? "#000" : "var(--gray-4)", cursor: "pointer" }}>H{l}</button>)}
      </div>
      <input className="block-input" style={{ fontFamily: "var(--font-display)", fontSize: block.level === 1 ? "1.8rem" : block.level === 2 ? "1.4rem" : "1.1rem" }} value={block.text} onChange={e => updateBlock({ text: e.target.value })} placeholder="Heading..." />
    </div>
  );

  if (block.type === BLOCK.QUOTE) return (
    <div className="block-wrap">
      {blockControls}
      <div style={{ borderLeft: "3px solid var(--accent)", paddingLeft: 16 }}>
        <textarea className="block-textarea" style={{ fontStyle: "italic" }} value={block.text} onChange={e => updateBlock({ text: e.target.value })} placeholder="A quote or key insight..." rows={2} />
      </div>
    </div>
  );

  if (block.type === BLOCK.IMAGE) return (
    <div className="block-wrap">
      {blockControls}
      {block.src ? (
        <div>
          <img src={block.src} alt="" style={{ width: "100%", display: "block", border: "1px solid var(--gray-2)", marginBottom: 8 }} />
          <input className="block-input" value={block.caption} onChange={e => updateBlock({ caption: e.target.value })} placeholder="Add a caption..." style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", letterSpacing: "0.1em" }} />
          <button className="block-btn-sm" onClick={() => updateBlock({ src: null, caption: "" })}>Remove image</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10 }}>
          <label className="block-upload-btn">
            📁 Choose File
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
              const file = e.target.files[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = ev => updateBlock({ src: ev.target.result });
              reader.readAsDataURL(file);
            }} />
          </label>
          <label className="block-upload-btn">
            📷 Take Photo
            <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => {
              const file = e.target.files[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = ev => updateBlock({ src: ev.target.result });
              reader.readAsDataURL(file);
            }} />
          </label>
        </div>
      )}
    </div>
  );

  if (block.type === BLOCK.DRAWING) return (
    <div className="block-wrap">
      {blockControls}
      {editingDrawing || !block.dataURL ? (
        <DrawingCanvas
          initialDataURL={block.dataURL}
          onSave={dataURL => { updateBlock({ dataURL }); setEditingDrawing(false); }}
          onCancel={() => setEditingDrawing(false)}
        />
      ) : (
        <div>
          <img src={block.dataURL} alt="Drawing" style={{ width: "100%", display: "block", border: "1px solid var(--gray-2)", marginBottom: 8 }} />
          <button className="block-btn-sm" onClick={() => setEditingDrawing(true)}>Edit Drawing</button>
        </div>
      )}
    </div>
  );

  if (block.type === BLOCK.CHECKLIST) return (
    <div className="block-wrap">
      {blockControls}
      <p className="block-type-label">Checklist</p>
      {block.items.map((item, idx) => (
        <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <div onClick={() => updateBlock({ items: updateItem(block.items, idx, { checked: !item.checked }) })}
            style={{ width: 16, height: 16, border: `1px solid ${item.checked ? "var(--accent)" : "var(--gray-3)"}`, background: item.checked ? "var(--accent)" : "none", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {item.checked && <span style={{ color: "#000", fontSize: 10, fontWeight: "bold" }}>✓</span>}
          </div>
          <input className="block-input" style={{ flex: 1, textDecoration: item.checked ? "line-through" : "none", color: item.checked ? "var(--gray-3)" : "var(--white)" }}
            value={item.text} onChange={e => updateBlock({ items: updateItem(block.items, idx, { text: e.target.value }) })}
            placeholder="Task..." onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); updateBlock({ items: addItem(block.items) }); } }}
          />
          <button onClick={() => updateBlock({ items: removeItem(block.items, idx) })} style={{ background: "none", border: "none", color: "var(--gray-3)", cursor: "pointer", fontSize: 14 }}>✕</button>
        </div>
      ))}
      <button className="block-btn-sm" onClick={() => updateBlock({ items: addItem(block.items) })}>+ Add item</button>
    </div>
  );

  if (block.type === BLOCK.BULLETS) return (
    <div className="block-wrap">
      {blockControls}
      <p className="block-type-label">Bullet List</p>
      {block.items.map((item, idx) => (
        <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ color: "var(--accent)", fontSize: "0.7rem", flexShrink: 0 }}>◆</span>
          <input className="block-input" style={{ flex: 1 }} value={item.text}
            onChange={e => updateBlock({ items: updateItem(block.items, idx, { text: e.target.value }) })}
            placeholder="Item..." onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); updateBlock({ items: addItem(block.items) }); } }}
          />
          <button onClick={() => updateBlock({ items: removeItem(block.items, idx) })} style={{ background: "none", border: "none", color: "var(--gray-3)", cursor: "pointer", fontSize: 14 }}>✕</button>
        </div>
      ))}
      <button className="block-btn-sm" onClick={() => updateBlock({ items: addItem(block.items) })}>+ Add item</button>
    </div>
  );

  if (block.type === BLOCK.TABLE) return (
    <div className="block-wrap">
      {blockControls}
      <p className="block-type-label">Table</p>
      <div style={{ overflowX: "auto", marginBottom: 8 }}>
        <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
          <tbody>
            {block.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{ border: "1px solid var(--gray-2)", padding: 0 }}>
                    <input value={cell} onChange={e => {
                      const rows = block.rows.map((r, rr) => r.map((c, cc) => rr === ri && cc === ci ? e.target.value : c));
                      updateBlock({ rows });
                    }} style={{ background: "none", border: "none", outline: "none", color: "var(--white)", fontFamily: ri === 0 ? "var(--font-mono)" : "var(--font-body)", fontSize: ri === 0 ? "0.62rem" : "0.95rem", padding: "8px 10px", width: "100%", minWidth: 80 }} placeholder={ri === 0 ? "Header" : "Cell"} />
                  </td>
                ))}
                <td style={{ border: "none", paddingLeft: 4 }}>
                  {block.rows.length > 1 && <button onClick={() => updateBlock({ rows: block.rows.filter((_, i) => i !== ri) })} style={{ background: "none", border: "none", color: "var(--gray-3)", cursor: "pointer", fontSize: 12 }}>✕</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="block-btn-sm" onClick={() => updateBlock({ rows: [...block.rows, new Array(block.cols).fill("")] })}>+ Row</button>
        <button className="block-btn-sm" onClick={() => updateBlock({ cols: block.cols + 1, rows: block.rows.map(r => [...r, ""]) })}>+ Col</button>
        {block.cols > 1 && <button className="block-btn-sm" onClick={() => updateBlock({ cols: block.cols - 1, rows: block.rows.map(r => r.slice(0, -1)) })}>- Col</button>}
      </div>
    </div>
  );

  if (block.type === BLOCK.DIVIDER) return (
    <div className="block-wrap" style={{ padding: "8px 0" }}>
      {blockControls}
      <div style={{ height: 1, background: "var(--gray-2)" }} />
    </div>
  );

  return null;
}

// ── Toolbar for adding blocks ─────────────────────────────────────────────────
function AddBlockToolbar({ onAdd }) {
  const [open, setOpen] = useState(false);
  const tools = [
    { type: BLOCK.TEXT,      icon: "¶",  label: "Text" },
    { type: BLOCK.HEADING,   icon: "H",  label: "Heading" },
    { type: BLOCK.QUOTE,     icon: "❝",  label: "Quote" },
    { type: BLOCK.CHECKLIST, icon: "✓",  label: "Checklist" },
    { type: BLOCK.BULLETS,   icon: "◆",  label: "List" },
    { type: BLOCK.TABLE,     icon: "⊞",  label: "Table" },
    { type: BLOCK.IMAGE,     icon: "⊡",  label: "Image" },
    { type: BLOCK.DRAWING,   icon: "✎",  label: "Draw" },
    { type: BLOCK.DIVIDER,   icon: "—",  label: "Divider" },
  ];
  return (
    <div style={{ margin: "12px 0" }}>
      <button onClick={() => setOpen(o => !o)} style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", letterSpacing: "0.15em", textTransform: "uppercase", padding: "8px 16px", background: "none", border: "1px dashed var(--gray-2)", color: "var(--gray-4)", cursor: "pointer", transition: "all 0.15s", width: "100%" }}
        onMouseEnter={e => { e.target.style.borderColor = "var(--accent)"; e.target.style.color = "var(--accent)"; }}
        onMouseLeave={e => { e.target.style.borderColor = "var(--gray-2)"; e.target.style.color = "var(--gray-4)"; }}>
        {open ? "✕ Close" : "+ Add Block"}
      </button>
      {open && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 8 }}>
          {tools.map(t => (
            <button key={t.type} onClick={() => { onAdd(t.type); setOpen(false); }}
              style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", letterSpacing: "0.1em", textTransform: "uppercase", padding: "10px 8px", background: "var(--gray-1)", border: "1px solid var(--gray-2)", color: "var(--gray-4)", cursor: "pointer", transition: "all 0.15s", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--white)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--gray-2)"; e.currentTarget.style.color = "var(--gray-4)"; }}>
              <span style={{ fontSize: "1rem" }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [entries, setEntries] = useState(() => loadEntries());
  const [view, setView] = useState("editor");
  const [activeEntry, setActiveEntry] = useState(null);

  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState([makeBlock(BLOCK.TEXT)]);
  const [mood, setMood] = useState(null);
  const [tags, setTags] = useState([]);

  const [recording, setRecording] = useState(false);
  const [voiceLang, setVoiceLang] = useState("en-US");
  const [audioURL, setAudioURL] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  const recognitionRef = useRef(null);
  const mediaRecRef = useRef(null);
  const audioChunksRef = useRef([]);
  const autoSaveRef = useRef(null);
  const committedTextRef = useRef("");
  const activeTextBlockRef = useRef(null); // id of the text block being voice-filled

  useEffect(() => { persistEntries(entries); }, [entries]);

  useEffect(() => {
    if (view !== "editor") return;
    autoSaveRef.current = setInterval(() => {
      if (title || blocks.some(b => getPlainText([b]))) { setSavedMsg(true); setTimeout(() => setSavedMsg(false), 2000); }
    }, 5000);
    return () => clearInterval(autoSaveRef.current);
  }, [view, title, blocks]);

  const saveEntries = useCallback((list) => { setEntries(list); persistEntries(list); }, []);

  const newEntry = () => {
    setTitle(""); setBlocks([makeBlock(BLOCK.TEXT)]); setMood(null); setTags([]); setAudioURL(null); setView("editor");
  };

  const updateBlock = (id, patch) => setBlocks(bs => bs.map(b => b.id === id ? { ...b, ...patch } : b));
  const deleteBlock = (id) => setBlocks(bs => bs.length > 1 ? bs.filter(b => b.id !== id) : bs);
  const moveBlock = (id, dir) => setBlocks(bs => {
    const idx = bs.findIndex(b => b.id === id);
    const next = [...bs];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return bs;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    return next;
  });
  const addBlockAfter = (afterId, type) => setBlocks(bs => {
    const idx = bs.findIndex(b => b.id === afterId);
    const nb = makeBlock(type);
    const next = [...bs];
    next.splice(idx + 1, 0, nb);
    return next;
  });
  const addBlock = (type) => setBlocks(bs => [...bs, makeBlock(type)]);

  const toggleTag = (tag) => setTags(ts => ts.includes(tag) ? ts.filter(t => t !== tag) : [...ts, tag]);

  // ── Voice ───────────────────────────────────────────────────────────────────
  const startRecording = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Use Chrome or Edge for voice recording."); return; }

    // Find first text block or create one to receive transcript
    const textBlock = blocks.find(b => b.type === BLOCK.TEXT);
    if (textBlock) {
      activeTextBlockRef.current = textBlock.id;
      committedTextRef.current = textBlock.text;
    } else {
      const nb = makeBlock(BLOCK.TEXT);
      setBlocks(bs => [...bs, nb]);
      activeTextBlockRef.current = nb.id;
      committedTextRef.current = "";
    }

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = voiceLang;

    recognition.onresult = (e) => {
      let finalChunk = "", interimChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalChunk += text + " ";
        else interimChunk += text;
      }
      if (finalChunk) committedTextRef.current += (committedTextRef.current ? " " : "") + finalChunk.trim();
      const display = committedTextRef.current + (interimChunk ? " " + interimChunk : "");
      const bid = activeTextBlockRef.current;
      setBlocks(bs => bs.map(b => b.id === bid ? { ...b, text: display } : b));
    };

    recognition.onerror = (e) => { if (e.error === "not-allowed") alert("Microphone permission denied."); };
    recognition.onend = () => {
      const bid = activeTextBlockRef.current;
      setBlocks(bs => bs.map(b => b.id === bid ? { ...b, text: committedTextRef.current } : b));
      setRecording(false);
    };

    recognition.start();
    recognitionRef.current = recognition;

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = e => audioChunksRef.current.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setAudioURL(URL.createObjectURL(blob));
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      mediaRecRef.current = mr;
    }).catch(() => alert("Microphone permission denied."));

    setRecording(true);
  };

  const stopRecording = () => { recognitionRef.current?.stop(); mediaRecRef.current?.stop(); };

  // ── Save ────────────────────────────────────────────────────────────────────
  const saveEntry = async () => {
    const plainText = getPlainText(blocks);
    if (!plainText && !title) return;
    setSaving(true);
    const entry = {
      id: Date.now().toString(), title: title || "Untitled Entry",
      blocks, mood, tags, timestamp: Date.now(),
      audioURL: audioURL || null, aiReflection: "",
    };
    try { if (plainText) entry.aiReflection = await askClaude(plainText); } catch {}
    saveEntries([entry, ...entries]);
    setSaving(false);
    setActiveEntry(entry);
    setView("detail");
  };

  const getAIReflection = async (entry) => {
    setAiLoading(true);
    try {
      const reflection = await askClaude(getPlainText(entry.blocks));
      const updated = entries.map(e => e.id === entry.id ? { ...e, aiReflection: reflection } : e);
      saveEntries(updated);
      setActiveEntry({ ...entry, aiReflection: reflection });
    } catch {}
    setAiLoading(false);
  };

  const deleteEntry = (id) => { saveEntries(entries.filter(e => e.id !== id)); newEntry(); };

  const wordCount = getPlainText(blocks).split(/\s+/).filter(Boolean).length;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=IBM+Plex+Mono:wght@300;400&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --black: #080810;
          --white: #f0eee8;
          --accent: #e8ff00;
          --accent2: #ff3bac;
          --accent3: #3bdfff;
          --gray-1: #12121e;
          --gray-2: #1e1e30;
          --gray-3: #44445a;
          --gray-4: #7777aa;
          --red: #ff3b3b;
          --glow: 0 0 24px rgba(232,255,0,0.18);
          --glow2: 0 0 32px rgba(255,59,172,0.15);
          --font-display: 'Bebas Neue', sans-serif;
          --font-body: 'Cormorant Garamond', serif;
          --font-mono: 'IBM Plex Mono', monospace;
        }
        html, body, #root {
          height: 100%; width: 100%;
          background: var(--black);
          color: var(--white);
          font-family: var(--font-body);
          font-size: 18px; line-height: 1.6;
          -webkit-font-smoothing: antialiased;
        }
        body::before {
          content: '';
          position: fixed; inset: 0; z-index: 0; pointer-events: none;
          background:
            radial-gradient(ellipse 80% 50% at 10% 0%, rgba(232,255,0,0.06) 0%, transparent 60%),
            radial-gradient(ellipse 60% 40% at 90% 100%, rgba(59,223,255,0.07) 0%, transparent 60%),
            radial-gradient(ellipse 50% 60% at 50% 50%, rgba(255,59,172,0.04) 0%, transparent 70%);
        }
        .app { display: grid; grid-template-columns: 270px 1fr; grid-template-rows: auto 1fr; min-height: 100vh; position: relative; z-index: 1; }

        /* HEADER */
        .header {
          grid-column: 1/-1;
          display: flex; align-items: center; justify-content: space-between;
          padding: 18px 36px;
          border-bottom: 1px solid var(--gray-2);
          position: sticky; top: 0; z-index: 100;
          background: rgba(8,8,16,0.85);
          backdrop-filter: blur(20px);
        }
        .header::after {
          content: '';
          position: absolute; bottom: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, var(--accent), var(--accent2), var(--accent3), transparent);
          opacity: 0.5;
        }
        .header-logo {
          font-family: var(--font-display);
          font-size: 2.4rem; letter-spacing: 0.06em; line-height: 1;
          text-shadow: 0 0 30px rgba(232,255,0,0.3);
        }
        .header-logo span { color: var(--accent); }
        .header-meta { font-family: var(--font-mono); font-size: 0.6rem; color: var(--gray-4); text-transform: uppercase; letter-spacing: 0.18em; }
        .header-actions { display: flex; gap: 10px; }
        .btn-ghost {
          background: none; border: 1px solid var(--gray-2); color: var(--gray-4);
          font-family: var(--font-mono); font-size: 0.58rem; letter-spacing: 0.12em; text-transform: uppercase;
          padding: 8px 16px; cursor: pointer; transition: all 0.2s;
        }
        .btn-ghost:hover { border-color: var(--accent); color: var(--accent); box-shadow: var(--glow); }
        .btn-ghost.active { border-color: var(--accent); color: var(--accent); box-shadow: var(--glow); }

        /* SIDEBAR */
        .sidebar {
          border-right: 1px solid var(--gray-2); overflow-y: auto;
          background: rgba(8,8,16,0.6);
        }
        .sidebar-header { padding: 18px 20px 12px; border-bottom: 1px solid var(--gray-2); display: flex; justify-content: space-between; align-items: center; }
        .sidebar-title { font-family: var(--font-mono); font-size: 0.56rem; letter-spacing: 0.25em; text-transform: uppercase; color: var(--gray-4); }
        .entry-count { font-family: var(--font-mono); font-size: 0.56rem; color: var(--accent); }
        .entry-item { padding: 14px 20px; border-bottom: 1px solid var(--gray-2); cursor: pointer; transition: all 0.15s; position: relative; }
        .entry-item:hover { background: var(--gray-1); }
        .entry-item.active { background: var(--gray-1); }
        .entry-item.active::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: linear-gradient(to bottom, var(--accent), var(--accent2)); }
        .entry-date { font-family: var(--font-mono); font-size: 0.52rem; letter-spacing: 0.15em; color: var(--accent); margin-bottom: 3px; }
        .entry-title { font-size: 0.9rem; color: var(--white); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 3px; }
        .entry-preview { font-size: 0.8rem; color: var(--gray-4); line-height: 1.4; font-style: italic; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .entry-blocks { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
        .entry-block-tag { font-family: var(--font-mono); font-size: 0.48rem; color: var(--accent2); border: 1px solid rgba(255,59,172,0.3); padding: 2px 6px; letter-spacing: 0.1em; text-transform: uppercase; }
        .sidebar-empty { padding: 40px 20px; text-align: center; font-family: var(--font-mono); font-size: 0.56rem; color: var(--gray-3); letter-spacing: 0.12em; text-transform: uppercase; }

        /* MAIN */
        .main { overflow-y: auto; display: flex; flex-direction: column; }

        /* EDITOR */
        .editor { flex: 1; padding: 40px 52px 80px; max-width: 880px; animation: fadeUp 0.4s ease both; }
        .editor-dateline { font-family: var(--font-mono); font-size: 0.58rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--gray-4); margin-bottom: 14px; display: flex; align-items: center; gap: 14px; }
        .editor-dateline::after { content: ''; flex: 1; height: 1px; background: linear-gradient(to right, var(--gray-2), transparent); }
        .editor-headline {
          font-family: var(--font-display);
          font-size: clamp(3rem, 6vw, 5.5rem);
          line-height: 0.92; letter-spacing: 0.02em; margin-bottom: 6px;
        }
        .editor-headline span {
          color: var(--accent);
          text-shadow: 0 0 40px rgba(232,255,0,0.4), 0 0 80px rgba(232,255,0,0.2);
        }
        .editor-subline { font-family: var(--font-body); font-size: 1rem; color: var(--gray-4); font-style: italic; font-weight: 300; margin-bottom: 32px; letter-spacing: 0.02em; }
        .title-input { width: 100%; background: none; border: none; border-bottom: 1px solid var(--gray-2); outline: none; color: var(--white); font-family: var(--font-body); font-size: 1.4rem; font-weight: 400; padding: 0 0 12px; margin-bottom: 24px; caret-color: var(--accent); transition: border-color 0.2s; }
        .title-input:focus { border-bottom-color: var(--accent); }
        .title-input::placeholder { color: var(--gray-3); font-style: italic; }

        /* BLOCKS */
        .block-wrap { position: relative; margin-bottom: 4px; padding: 10px 14px; border: 1px solid transparent; border-radius: 2px; transition: all 0.15s; }
        .block-wrap:hover { border-color: var(--gray-2); background: rgba(30,30,48,0.4); }
        .block-wrap:hover .block-controls { opacity: 1; }
        .block-controls { position: absolute; top: 6px; right: 8px; display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; z-index: 10; }
        .block-controls button { background: var(--gray-1); border: 1px solid var(--gray-2); color: var(--gray-4); font-size: 11px; padding: 3px 8px; cursor: pointer; font-family: var(--font-mono); transition: all 0.1s; }
        .block-controls button:hover { color: var(--accent); border-color: var(--accent); }
        .block-textarea { width: 100%; background: none; border: none; outline: none; resize: none; color: var(--white); font-family: var(--font-body); font-size: 1.15rem; line-height: 1.9; font-weight: 300; caret-color: var(--accent); }
        .block-textarea::placeholder { color: var(--gray-3); font-style: italic; }
        .block-input { width: 100%; background: none; border: none; border-bottom: 1px solid var(--gray-2); outline: none; color: var(--white); font-family: var(--font-body); font-size: 1.05rem; font-weight: 300; padding: 4px 0; caret-color: var(--accent); }
        .block-input::placeholder { color: var(--gray-3); }
        .block-type-label { font-family: var(--font-mono); font-size: 0.5rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--accent2); margin-bottom: 8px; }
        .block-btn-sm { font-family: var(--font-mono); font-size: 0.54rem; letter-spacing: 0.12em; text-transform: uppercase; padding: 5px 10px; background: none; border: 1px solid var(--gray-2); color: var(--gray-4); cursor: pointer; margin-top: 6px; transition: all 0.15s; }
        .block-btn-sm:hover { border-color: var(--accent); color: var(--accent); }
        .block-upload-btn { font-family: var(--font-mono); font-size: 0.56rem; letter-spacing: 0.1em; text-transform: uppercase; padding: 12px 18px; background: var(--gray-1); border: 1px solid var(--gray-2); color: var(--gray-4); cursor: pointer; transition: all 0.2s; display: inline-block; }
        .block-upload-btn:hover { border-color: var(--accent); color: var(--accent); box-shadow: var(--glow); }

        /* DIVIDER */
        .divider { height: 1px; background: linear-gradient(to right, transparent, var(--gray-2), transparent); margin: 24px 0; }

        /* MOOD */
        .section-label { font-family: var(--font-mono); font-size: 0.54rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--gray-4); margin-bottom: 10px; }
        .mood-grid { display: flex; gap: 7px; flex-wrap: wrap; margin-bottom: 22px; }
        .mood-btn { background: var(--gray-1); border: 1px solid var(--gray-2); color: var(--white); font-family: var(--font-mono); font-size: 0.56rem; letter-spacing: 0.08em; padding: 8px 13px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 7px; }
        .mood-btn:hover { border-color: var(--accent2); box-shadow: var(--glow2); }
        .mood-btn.selected { background: linear-gradient(135deg, rgba(232,255,0,0.15), rgba(255,59,172,0.1)); border-color: var(--accent); color: var(--accent); box-shadow: var(--glow); }

        /* TAGS */
        .tags-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 26px; }
        .tag-btn { background: none; border: 1px solid var(--gray-2); color: var(--gray-4); font-family: var(--font-mono); font-size: 0.52rem; letter-spacing: 0.14em; text-transform: uppercase; padding: 5px 11px; cursor: pointer; transition: all 0.2s; }
        .tag-btn:hover { border-color: var(--accent3); color: var(--accent3); }
        .tag-btn.selected { border-color: var(--accent3); color: var(--accent3); box-shadow: 0 0 12px rgba(59,223,255,0.2); }

        /* AUDIO */
        .audio-block { background: linear-gradient(135deg, var(--gray-1), rgba(30,30,48,0.8)); border: 1px solid var(--gray-2); padding: 14px 18px; margin-bottom: 18px; }
        .audio-label { font-family: var(--font-mono); font-size: 0.54rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); margin-bottom: 8px; }
        audio { width: 100%; height: 32px; accent-color: var(--accent); }

        /* ACTIONS */
        .editor-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
        .btn-primary {
          background: var(--white); border: none; color: var(--black);
          font-family: var(--font-mono); font-size: 0.6rem; letter-spacing: 0.16em; text-transform: uppercase;
          padding: 13px 26px; cursor: pointer; transition: all 0.2s; font-weight: 400;
        }
        .btn-primary:hover { background: var(--accent); box-shadow: var(--glow); }
        .btn-primary:disabled { opacity: 0.3; cursor: not-allowed; }
        .btn-accent {
          background: linear-gradient(135deg, var(--accent), #c8e000);
          border: none; color: var(--black);
          font-family: var(--font-mono); font-size: 0.6rem; letter-spacing: 0.16em; text-transform: uppercase;
          padding: 13px 26px; cursor: pointer; transition: all 0.2s;
        }
        .btn-accent:hover { box-shadow: var(--glow); transform: translateY(-1px); }
        .btn-accent:disabled { opacity: 0.3; cursor: not-allowed; }
        .btn-mic {
          background: none; border: 1px solid var(--gray-2); color: var(--gray-4);
          font-family: var(--font-mono); font-size: 0.58rem; letter-spacing: 0.1em; text-transform: uppercase;
          padding: 13px 18px; cursor: pointer; transition: all 0.2s;
          display: flex; align-items: center; gap: 8px;
        }
        .btn-mic:hover { border-color: var(--red); color: var(--red); }
        .btn-mic.recording { border-color: var(--red); color: var(--red); animation: pulse-border 1.2s infinite; }
        .btn-danger { background: none; border: 1px solid #2a0a0a; color: var(--red); font-family: var(--font-mono); font-size: 0.58rem; letter-spacing: 0.12em; text-transform: uppercase; padding: 10px 18px; cursor: pointer; transition: all 0.2s; }
        .btn-danger:hover { border-color: var(--red); box-shadow: 0 0 12px rgba(255,59,59,0.2); }
        .word-count { font-family: var(--font-mono); font-size: 0.54rem; color: var(--gray-3); letter-spacing: 0.1em; }
        .autosave { font-family: var(--font-mono); font-size: 0.54rem; color: #3adf8a; letter-spacing: 0.1em; margin-left: auto; }

        @keyframes pulse-border { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,59,59,0.4); } 50% { box-shadow: 0 0 0 8px rgba(255,59,59,0); } }

        /* REFLECTION */
        .reflection-panel { margin-top: 40px; padding-top: 30px; border-top: 1px solid var(--gray-2); position: relative; }
        .reflection-panel::before { content: 'AI REFLECTION'; position: absolute; top: -9px; left: 0; font-family: var(--font-mono); font-size: 0.5rem; letter-spacing: 0.3em; color: var(--accent2); background: var(--black); padding-right: 12px; }
        .reflection-label { font-family: var(--font-display); font-size: 0.7rem; letter-spacing: 0.35em; color: var(--gray-4); margin-bottom: 18px; display: none; }
        .reflection-text { font-family: var(--font-body); font-size: 1.15rem; line-height: 1.95; font-style: italic; font-weight: 300; padding: 20px 24px; border-left: 2px solid var(--accent2); background: linear-gradient(135deg, rgba(255,59,172,0.05), transparent); color: var(--white); }
        .dot-pulse { display: flex; gap: 6px; align-items: center; padding: 12px 0; }
        .dot-pulse span { width: 6px; height: 6px; background: var(--accent); border-radius: 50%; animation: blink 1.4s infinite; }
        .dot-pulse span:nth-child(2) { animation-delay: 0.25s; background: var(--accent2); }
        .dot-pulse span:nth-child(3) { animation-delay: 0.5s; background: var(--accent3); }
        @keyframes blink { 0%, 80%, 100% { opacity: 0.1; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.2); } }

        /* DETAIL */
        .detail-view { padding: 40px 52px 80px; max-width: 880px; animation: fadeUp 0.35s ease both; }
        .detail-back { font-family: var(--font-mono); font-size: 0.56rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--gray-4); background: none; border: none; cursor: pointer; margin-bottom: 32px; display: flex; align-items: center; gap: 8px; transition: color 0.2s; padding: 0; }
        .detail-back:hover { color: var(--accent); }
        .detail-headline { font-family: var(--font-display); font-size: clamp(2.2rem, 5vw, 4.2rem); line-height: 0.92; margin-bottom: 16px; letter-spacing: 0.02em; }
        .detail-date { font-family: var(--font-mono); font-size: 0.58rem; letter-spacing: 0.22em; color: var(--accent); text-transform: uppercase; margin-bottom: 18px; }
        .detail-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 22px; }
        .detail-tag { font-family: var(--font-mono); font-size: 0.5rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent3); border: 1px solid rgba(59,223,255,0.3); padding: 4px 10px; }
        .detail-actions { display: flex; gap: 10px; margin-top: 36px; flex-wrap: wrap; }

        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--gray-2); }

        @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }

        @media (max-width: 700px) {
          .app { grid-template-columns: 1fr; }
          .sidebar { display: none; }
          .editor, .detail-view { padding: 20px 18px 80px; }
          .editor-headline { font-size: 2.8rem; }
          .detail-headline { font-size: 2rem; }
        }
      `}</style>

      <div className="app">

        {/* HEADER */}
        <header className="header">
          <div className="header-logo">THE<span>JOURNAL</span></div>
          <div className="header-meta">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase()}</div>
          <div className="header-actions">
            <button className={`btn-ghost ${view === "editor" ? "active" : ""}`} onClick={newEntry}>New Entry</button>
            <button className="btn-ghost">Archive ({entries.length})</button>
          </div>
        </header>

        {/* SIDEBAR */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <span className="sidebar-title">Recent</span>
            <span className="entry-count">{entries.length}</span>
          </div>
          {entries.length === 0 ? (
            <div className="sidebar-empty">No entries yet</div>
          ) : entries.map(entry => (
            <div key={entry.id} className={`entry-item ${activeEntry?.id === entry.id && view === "detail" ? "active" : ""}`} onClick={() => { setActiveEntry(entry); setView("detail"); }}>
              <div className="entry-date">{shortDate(entry.timestamp)}</div>
              <div className="entry-title">{entry.title}</div>
              <div className="entry-preview">{getPlainText(entry.blocks || [])}</div>
              <div className="entry-blocks">
                {[...new Set((entry.blocks || []).map(b => b.type).filter(t => t !== BLOCK.TEXT))].map(t => (
                  <span key={t} className="entry-block-tag">{t}</span>
                ))}
                {entry.mood && <span className="entry-block-tag">{entry.mood.emoji}</span>}
              </div>
            </div>
          ))}
        </aside>

        {/* MAIN */}
        <main className="main">

          {/* ── EDITOR ── */}
          {view === "editor" && (
            <div className="editor">
              <div className="editor-dateline">
                {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }).toUpperCase()}
                <span style={{ color: "var(--gray-2)" }}>◆</span>
                Personal Record
              </div>
              <h1 className="editor-headline">What's on<br />your <span>mind?</span></h1>
              <p className="editor-subline">Your thoughts, your world — captured in every dimension.</p>

              <input className="title-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Give this entry a title..." />

              {/* BLOCKS */}
              {blocks.map((block, idx) => (
                <BlockEditor
                  key={block.id}
                  block={block}
                  onChange={updated => updateBlock(block.id, updated)}
                  onDelete={() => deleteBlock(block.id)}
                  onMoveUp={() => moveBlock(block.id, -1)}
                  onMoveDown={() => moveBlock(block.id, 1)}
                  onAddAfter={(type) => addBlockAfter(block.id, type)}
                />
              ))}

              <AddBlockToolbar onAdd={addBlock} />

              {audioURL && (
                <div className="audio-block">
                  <div className="audio-label">⏺ Voice Recording</div>
                  <audio controls src={audioURL} />
                </div>
              )}

              <div className="divider" />

              <p className="section-label">Today's register</p>
              <div className="mood-grid">
                {MOODS.map(m => (
                  <button key={m.label} className={`mood-btn ${mood?.label === m.label ? "selected" : ""}`} onClick={() => setMood(mood?.label === m.label ? null : m)}>
                    <span>{m.emoji}</span>{m.label}
                  </button>
                ))}
              </div>

              <p className="section-label">Index</p>
              <div className="tags-row">
                {TAGS.map(tag => (
                  <button key={tag} className={`tag-btn ${tags.includes(tag) ? "selected" : ""}`} onClick={() => toggleTag(tag)}>{tag}</button>
                ))}
              </div>

              <div className="editor-actions">
                <button className="btn-primary" onClick={saveEntry} disabled={saving || (!getPlainText(blocks) && !title)}>
                  {saving ? "Saving..." : "Save Entry"}
                </button>
                <button className={`btn-mic ${recording ? "recording" : ""}`} onClick={recording ? stopRecording : startRecording}>
                  <span>{recording ? "⬛" : "⏺"}</span>{recording ? "Stop" : "Voice"}
                </button>
                <select value={voiceLang} onChange={e => setVoiceLang(e.target.value)} style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", background: "var(--gray-1)", border: "1px solid var(--gray-2)", color: "var(--gray-4)", padding: "10px 10px", cursor: "pointer", outline: "none", letterSpacing: "0.08em" }}>
                  {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
                <span className="word-count">{wordCount} {wordCount === 1 ? "word" : "words"}</span>
                {savedMsg && <span className="autosave">✓ saved</span>}
              </div>
            </div>
          )}

          {/* ── DETAIL ── */}
          {view === "detail" && activeEntry && (
            <div className="detail-view">
              <button className="detail-back" onClick={newEntry}>← New entry</button>
              <div className="detail-headline">{activeEntry.title || "Untitled Entry"}</div>
              <div className="detail-date">
                {formatDate(activeEntry.timestamp).toUpperCase()}
                {activeEntry.mood && <span style={{ marginLeft: 14 }}>{activeEntry.mood.emoji} {activeEntry.mood.label}</span>}
              </div>
              {activeEntry.tags?.length > 0 && (
                <div className="detail-tags">{activeEntry.tags.map(t => <span key={t} className="detail-tag">{t}</span>)}</div>
              )}
              <div className="divider" />

              {/* Render all blocks */}
              {(activeEntry.blocks || []).map(block => <BlockViewer key={block.id} block={block} />)}

              {activeEntry.audioURL && (
                <div className="audio-block" style={{ marginTop: 20 }}>
                  <div className="audio-label">⏺ Voice Recording</div>
                  <audio controls src={activeEntry.audioURL} />
                </div>
              )}

              <div className="reflection-panel">
                <div className="reflection-label">Reflection</div>
                {aiLoading ? <div className="dot-pulse"><span /><span /><span /></div>
                  : activeEntry.aiReflection
                    ? <p className="reflection-text">{activeEntry.aiReflection}</p>
                    : <button className="btn-accent" onClick={() => getAIReflection(activeEntry)} disabled={aiLoading}>Get AI Reflection</button>
                }
              </div>

              <div className="detail-actions">
                <button className="btn-danger" onClick={() => deleteEntry(activeEntry.id)}>Delete Entry</button>
              </div>
            </div>
          )}

        </main>
      </div>
    </>
  );
}