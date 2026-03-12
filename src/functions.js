// functions/index.js
// Firebase Cloud Function — Anthropic API Proxy
// Keeps your API key safe on the server, never exposed to the app.

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const fetch = require("node-fetch");

// Store your API key securely via Firebase Secret Manager
// Set it once with: firebase functions:secrets:set ANTHROPIC_API_KEY
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

exports.claudeProxy = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true },
  async (req, res) => {
    // Only allow POST
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { entryText } = req.body;

    if (!entryText || typeof entryText !== "string") {
      return res.status(400).json({ error: "Missing or invalid entryText" });
    }

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY.value(),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system:
            "You are a warm, empathetic journaling assistant. When given a journal entry, provide a brief (3-5 sentence) thoughtful reflection: acknowledge the emotions, offer a meaningful insight, and end with one gentle follow-up question to deepen self-reflection. Be concise, human, and supportive.",
          messages: [{ role: "user", content: `Journal entry:\n\n${entryText}` }],
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: data });
      }

      const reflection = data.content?.[0]?.text || "No reflection available.";
      return res.status(200).json({ reflection });

    } catch (err) {
      console.error("Proxy error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);