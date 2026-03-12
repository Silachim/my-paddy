// App.jsx — Capacitor-Ready AI Journal
// Dependencies: @capacitor/core, @capacitor/filesystem, @capacitor/preferences,
//               @capacitor-community/speech-recognition, @capacitor/microphone

import { useState, useEffect, useRef, useCallback } from "react";
import { Preferences } from "@capacitor/preferences";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { SpeechRecognition } from "@capacitor-community/speech-recognition";

const MOODS = ["😊","😔","😤","😌","🤔","😴","🥳","😰","❤️","🔥"];
const COLORS = ["#f9a8d4","#86efac","#93c5fd","#fcd34d","#c4b5fd","#fdba74"];
const GRADIENTS = [
  "linear-gradient(135deg,#fce4ec,#f3e5f5)",
  "linear-gradient(135deg,#e8f5e9,#e3f2fd)",
  "linear-gradient(135deg,#fff8e1,#fce4ec)",
  "linear-gradient(135deg,#ede7f6,#e8eaf6)",
];
const STORAGE_KEY = "journal_entries_v1";
// 🔐 Your deployed Firebase Function URL — replace with your actual URL
// Format: https://<region>-<project-id>.cloudfunctions.net/claudeProxy
const PROXY_URL = "https://YOUR_REGION-YOUR_PROJECT_ID.cloudfunctions.net/claudeProxy";

function formatDate(ts) {
  return new Date(ts).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

// ── Persistent Storage via Capacitor Preferences ──────────────────────────────
async function loadEntries() {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    return value ? JSON.parse(value) : [];
  } catch { return []; }
}

async function persistEntries(list) {
  try {
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(list) });
  } catch {}
}

// ── Save audio blob to device filesystem ──────────────────────────────────────
async function saveAudioFile(blob, filename) {
  try {
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(",")[1]);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
    await Filesystem.writeFile({
      path: `journal_audio/${filename}`,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    });
    return `journal_audio/${filename}`;
  } catch (e) {
    console.error("Audio save failed:", e);
    return null;
  }
}

// ── Read audio file back as object URL ────────────────────────────────────────
async function loadAudioFile(path) {
  try {
    const { data } = await Filesystem.readFile({ path, directory: Directory.Documents });
    const blob = await fetch(`data:audio/webm;base64,${data}`).then(r => r.blob());
    return URL.createObjectURL(blob);
  } catch { return null; }
}

// ── Claude API ────────────────────────────────────────────────────────────────
async function askClaude(text) {
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entryText: text }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error || "Proxy error");
  return d.reflection || "I couldn't reflect on this entry right now.";
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [entries, setEntries] = useState([]);
  const [view, setView] = useState("home");
  const [activeEntry, setActiveEntry] = useState(null);
  const [draft, setDraft] = useState({ title: "", body: "", mood: "😊", tags: "" });
  const [recording, setRecording] = useState(false);
  const [audioPath, setAudioPath] = useState(null);
  const [audioURL, setAudioURL] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const mediaRecRef = useRef(null);
  const audioChunks = useRef([]);
  const autoSaveRef = useRef(null);
  const gradIdx = useRef(Math.floor(Math.random() * GRADIENTS.length));

  // Load entries on mount
  useEffect(() => { loadEntries().then(setEntries); }, []);

  const saveEntries = useCallback(async (list) => {
    setEntries(list);
    await persistEntries(list);
  }, []);

  // Auto-save draft indicator every 5s
  useEffect(() => {
    if (view !== "write") return;
    autoSaveRef.current = setInterval(() => {
      if (draft.body.trim() || draft.title.trim()) {
        setSavedMsg(true);
        setTimeout(() => setSavedMsg(false), 2000);
      }
    }, 5000);
    return () => clearInterval(autoSaveRef.current);
  }, [view, draft]);

  // ── Recording: Capacitor SpeechRecognition + MediaRecorder ────────────────
  const startRecording = async () => {
    // Request permissions
    const { speechState } = await SpeechRecognition.requestPermissions();
    if (speechState !== "granted") { alert("Microphone permission denied."); return; }

    // Start speech-to-text (continuous, multi-voice via device mic)
    await SpeechRecognition.start({
      language: "en-US",
      maxResults: 1,
      prompt: "Speak now...",
      partialResults: true,
      popup: false,
    });

    SpeechRecognition.addListener("partialResults", ({ matches }) => {
      if (matches?.length) {
        setDraft(d => ({ ...d, body: d.body + " " + matches[0] }));
      }
    });

    // Also capture raw audio
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunks.current = [];
      mr.ondataavailable = e => audioChunks.current.push(e.data);
      mr.onstop = async () => {
        const blob = new Blob(audioChunks.current, { type: "audio/webm" });
        const filename = `rec_${Date.now()}.webm`;
        const path = await saveAudioFile(blob, filename);
        setAudioPath(path);
        setAudioURL(URL.createObjectURL(blob));
      };
      mr.start();
      mediaRecRef.current = mr;
    } catch (e) { console.warn("Raw audio capture unavailable:", e); }

    setRecording(true);
  };

  const stopRecording = async () => {
    await SpeechRecognition.stop();
    SpeechRecognition.removeAllListeners();
    mediaRecRef.current?.stop();
    setRecording(false);
  };

  // ── Save Entry ─────────────────────────────────────────────────────────────
  const saveEntry = async () => {
    if (!draft.body.trim() && !draft.title.trim()) return;
    setSaving(true);
    const entry = {
      id: Date.now(),
      title: draft.title || "Untitled Entry",
      body: draft.body,
      mood: draft.mood,
      tags: draft.tags.split(",").map(t => t.trim()).filter(Boolean),
      timestamp: Date.now(),
      audioPath: audioPath || null,
      aiReflection: "",
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    };
    try { entry.aiReflection = await askClaude(draft.body); } catch {}
    const updated = [entry, ...entries];
    await saveEntries(updated);
    setSaving(false);
    setDraft({ title: "", body: "", mood: "😊", tags: "" });
    setAudioPath(null);
    setAudioURL(null);
    setActiveEntry(entry);
    setView("entry");
  };

  // ── Load audio when viewing an entry ──────────────────────────────────────
  useEffect(() => {
    if (view === "entry" && activeEntry?.audioPath) {
      loadAudioFile(activeEntry.audioPath).then(setAudioURL);
    }
  }, [view, activeEntry]);

  const getAIReflection = async (entry) => {
    setAiLoading(true);
    try {
      const ref = await askClaude(entry.body);
      const updated = entries.map(e => e.id === entry.id ? { ...e, aiReflection: ref } : e);
      await saveEntries(updated);
      setActiveEntry({ ...entry, aiReflection: ref });
    } catch {}
    setAiLoading(false);
  };

  const deleteEntry = async (id) => {
    const entry = entries.find(e => e.id === id);
    if (entry?.audioPath) {
      try { await Filesystem.deleteFile({ path: entry.audioPath, directory: Directory.Documents }); } catch {}
    }
    await saveEntries(entries.filter(e => e.id !== id));
    setView("home");
  };

  const bg = GRADIENTS[gradIdx.current];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: bg, fontFamily: "'Segoe UI',sans-serif", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <div style={{ padding: "48px 20px 10px", background: "rgba(255,255,255,0.6)", backdropFilter: "blur(10px)", position: "sticky", top: 0, zIndex: 10, borderBottom: "1px solid rgba(255,255,255,0.8)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#6b21a8" }}>✨ My Journal</div>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
          </div>
          {view !== "write" && (
            <button onClick={() => { setView("write"); setDraft({ title: "", body: "", mood: "😊", tags: "" }); setAudioPath(null); setAudioURL(null); }}
              style={{ background: "linear-gradient(135deg,#a855f7,#6366f1)", color: "#fff", border: "none", borderRadius: 50, padding: "10px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer", boxShadow: "0 4px 12px rgba(168,85,247,0.4)" }}>
              + New
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 90px" }}>

        {/* HOME */}
        {view === "home" && (
          entries.length === 0
            ? <div style={{ textAlign: "center", marginTop: 80, color: "#a78bfa" }}>
                <div style={{ fontSize: 56 }}>📓</div>
                <div style={{ fontWeight: 700, fontSize: 18, marginTop: 12 }}>No entries yet</div>
                <div style={{ fontSize: 14, color: "#c4b5fd", marginTop: 6 }}>Tap "+ New" to write your first entry</div>
              </div>
            : entries.map(e => (
                <div key={e.id} onClick={() => { setActiveEntry(e); setView("entry"); }}
                  style={{ background: "rgba(255,255,255,0.75)", borderRadius: 20, padding: 16, marginBottom: 14, cursor: "pointer", boxShadow: "0 2px 12px rgba(0,0,0,0.07)", borderLeft: `5px solid ${e.color}`, backdropFilter: "blur(6px)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 700, fontSize: 16, color: "#4c1d95", flex: 1, marginRight: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.title}</div>
                    <span style={{ fontSize: 22 }}>{e.mood}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{e.body}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: "#a78bfa" }}>{formatDate(e.timestamp)}</div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {e.audioPath && <span style={{ fontSize: 11, background: "#ede9fe", color: "#7c3aed", borderRadius: 10, padding: "2px 8px" }}>🎙 audio</span>}
                      {e.tags.slice(0, 2).map(t => <span key={t} style={{ fontSize: 11, background: "#fce7f3", color: "#be185d", borderRadius: 10, padding: "2px 8px" }}>#{t}</span>)}
                    </div>
                  </div>
                </div>
              ))
        )}

        {/* WRITE */}
        {view === "write" && (
          <div style={{ background: "rgba(255,255,255,0.85)", borderRadius: 24, padding: 20, boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}>
            <input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              placeholder="Entry title..."
              style={{ width: "100%", border: "none", background: "transparent", fontSize: 20, fontWeight: 700, color: "#4c1d95", outline: "none", marginBottom: 12, boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              {MOODS.map(m => (
                <button key={m} onClick={() => setDraft(d => ({ ...d, mood: m }))}
                  style={{ fontSize: 20, background: draft.mood === m ? "#ede9fe" : "transparent", border: draft.mood === m ? "2px solid #a855f7" : "2px solid transparent", borderRadius: 10, cursor: "pointer", padding: 2 }}>
                  {m}
                </button>
              ))}
            </div>
            <textarea value={draft.body} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
              placeholder="What's on your mind? Write or tap the mic to record all voices..."
              style={{ width: "100%", minHeight: 160, border: "none", background: "#faf5ff", borderRadius: 14, padding: 14, fontSize: 15, color: "#374151", outline: "none", resize: "none", lineHeight: 1.7, boxSizing: "border-box" }} />
            <input value={draft.tags} onChange={e => setDraft(d => ({ ...d, tags: e.target.value }))}
              placeholder="Tags (comma separated)"
              style={{ width: "100%", border: "none", background: "#fdf2f8", borderRadius: 12, padding: "10px 14px", fontSize: 13, color: "#6b7280", outline: "none", marginTop: 10, boxSizing: "border-box" }} />
            {audioURL && (
              <div style={{ marginTop: 12, background: "#ede9fe", borderRadius: 12, padding: 10 }}>
                <div style={{ fontSize: 12, color: "#7c3aed", fontWeight: 600, marginBottom: 6 }}>🎙 Recorded Audio</div>
                <audio controls src={audioURL} style={{ width: "100%", height: 36 }} />
              </div>
            )}
            {savedMsg && <div style={{ fontSize: 12, color: "#10b981", marginTop: 8, textAlign: "right" }}>✓ Auto-saved</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={recording ? stopRecording : startRecording}
                style={{ flex: 1, padding: "12px 0", borderRadius: 50, border: "none", background: recording ? "linear-gradient(135deg,#ef4444,#dc2626)" : "linear-gradient(135deg,#8b5cf6,#6366f1)", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                {recording ? "⏹ Stop" : "🎙 Record"}
              </button>
              <button onClick={saveEntry} disabled={saving || (!draft.body.trim() && !draft.title.trim())}
                style={{ flex: 1, padding: "12px 0", borderRadius: 50, border: "none", background: saving ? "#e5e7eb" : "linear-gradient(135deg,#f472b6,#a855f7)", color: saving ? "#9ca3af" : "#fff", fontWeight: 700, fontSize: 14, cursor: saving ? "not-allowed" : "pointer" }}>
                {saving ? "Saving..." : "💾 Save"}
              </button>
            </div>
            <button onClick={() => setView("home")} style={{ width: "100%", marginTop: 10, padding: "10px 0", borderRadius: 50, border: "2px solid #e9d5ff", background: "transparent", color: "#9333ea", fontWeight: 600, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        )}

        {/* ENTRY VIEW */}
        {view === "entry" && activeEntry && (
          <div>
            <button onClick={() => setView("home")} style={{ background: "rgba(255,255,255,0.7)", border: "none", borderRadius: 50, padding: "8px 16px", color: "#7c3aed", fontWeight: 600, cursor: "pointer", marginBottom: 14 }}>← Back</button>
            <div style={{ background: "rgba(255,255,255,0.85)", borderRadius: 24, padding: 20, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", borderTop: `6px solid ${activeEntry.color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#4c1d95", flex: 1 }}>{activeEntry.title}</div>
                <span style={{ fontSize: 28 }}>{activeEntry.mood}</span>
              </div>
              <div style={{ fontSize: 12, color: "#a78bfa", marginTop: 4 }}>{formatDate(activeEntry.timestamp)}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {activeEntry.tags.map(t => <span key={t} style={{ fontSize: 12, background: "#fce7f3", color: "#be185d", borderRadius: 10, padding: "3px 10px" }}>#{t}</span>)}
              </div>
              <div style={{ marginTop: 16, fontSize: 15, color: "#374151", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{activeEntry.body}</div>
              {audioURL && (
                <div style={{ marginTop: 16, background: "#ede9fe", borderRadius: 14, padding: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed", marginBottom: 8 }}>🎙 Voice Recording</div>
                  <audio controls src={audioURL} style={{ width: "100%" }} />
                </div>
              )}
              <div style={{ marginTop: 20, background: "linear-gradient(135deg,#fdf4ff,#ede9fe)", borderRadius: 16, padding: 16 }}>
                <div style={{ fontWeight: 700, color: "#7c3aed", fontSize: 14, marginBottom: 8 }}>✨ AI Reflection</div>
                {activeEntry.aiReflection
                  ? <div style={{ fontSize: 14, color: "#4c1d95", lineHeight: 1.7 }}>{activeEntry.aiReflection}</div>
                  : <button onClick={() => getAIReflection(activeEntry)} disabled={aiLoading}
                      style={{ width: "100%", padding: "10px 0", borderRadius: 50, border: "none", background: "linear-gradient(135deg,#a855f7,#6366f1)", color: "#fff", fontWeight: 700, fontSize: 14, cursor: aiLoading ? "not-allowed" : "pointer", opacity: aiLoading ? 0.7 : 1 }}>
                      {aiLoading ? "Reflecting..." : "✨ Get AI Reflection"}
                    </button>
                }
              </div>
              <button onClick={() => deleteEntry(activeEntry.id)}
                style={{ width: "100%", marginTop: 16, padding: "10px 0", borderRadius: 50, border: "2px solid #fca5a5", background: "transparent", color: "#ef4444", fontWeight: 600, cursor: "pointer" }}>
                🗑 Delete Entry
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Nav */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "rgba(255,255,255,0.85)", backdropFilter: "blur(12px)", borderTop: "1px solid rgba(255,255,255,0.9)", display: "flex", justifyContent: "space-around", padding: "10px 0 24px", zIndex: 20 }}>
        <button onClick={() => setView("home")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: view === "home" ? "#7c3aed" : "#9ca3af", fontWeight: view === "home" ? 700 : 400 }}>
          <span style={{ fontSize: 22 }}>🏠</span><span style={{ fontSize: 11 }}>Home</span>
        </button>
        <button onClick={() => { setView("write"); setDraft({ title: "", body: "", mood: "😊", tags: "" }); setAudioPath(null); setAudioURL(null); }}
          style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: view === "write" ? "#7c3aed" : "#9ca3af", fontWeight: view === "write" ? 700 : 400 }}>
          <span style={{ fontSize: 22 }}>✏️</span><span style={{ fontSize: 11 }}>Write</span>
        </button>
        <button onClick={() => setView("home")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: "#9ca3af" }}>
          <span style={{ fontSize: 22 }}>📚</span><span style={{ fontSize: 11 }}>Entries ({entries.length})</span>
        </button>
      </div>
    </div>
  );
}