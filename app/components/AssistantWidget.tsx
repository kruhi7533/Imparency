"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, X, SendHorizonal } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "How does milestone funding work?",
  "Do I get a tax receipt?",
  "How are NGOs verified?",
];

const GREETING: ChatMessage = {
  role: "assistant",
  content:
    "Namaste, I'm Setu — the bridge between you and verified impact. Ask me anything about donating, NGO verification, or how your money is tracked.",
};

export default function AssistantWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  // The assistant is donor/NGO-facing — keep it out of the focused login flow
  // and the admin console (which has its own workspace tooling).
  if (pathname === "/login" || pathname?.startsWith("/admin")) return null;

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The greeting is client-side flavor, not model output worth resending.
        body: JSON.stringify({ messages: nextMessages.slice(1) }),
      });
      const data = await res.json();
      const reply =
        typeof data?.reply === "string" && data.reply
          ? data.reply
          : data?.error || "I couldn't answer that just now — please try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "I lost my connection for a moment — please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Chat panel */}
      <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 12 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          style={{ transformOrigin: "bottom right" }}
          className="fixed bottom-24 right-4 sm:right-6 z-50 w-[calc(100vw-2rem)] max-w-sm bg-gray-950 border border-gray-800 border-t-2 border-t-gold-500/70 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900/60">
            <div>
              <div className="font-display italic font-semibold text-white text-lg leading-tight">
                Setu<span className="text-gold-400">.</span>
              </div>
              <div className="font-mono text-[10px] text-gray-400 uppercase tracking-widest">
                24/7 · Every question answered
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="text-gray-500 hover:text-white transition p-1"
            >
              <X className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 max-h-[50vh] min-h-[200px]">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] px-3.5 py-2.5 rounded-lg text-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-trust-600/25 border border-trust-500/30 text-gray-100"
                      : "bg-gray-900 border border-gray-800 text-gray-300"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-900 border border-gray-800 rounded-lg px-3.5 py-2.5 flex items-center gap-1.5">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="w-1.5 h-1.5 rounded-full bg-gold-400/70 animate-bounce"
                      style={{ animationDelay: `${d * 150}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Suggestion chips — only before the first user message */}
            {messages.length === 1 && !loading && (
              <div className="flex flex-wrap gap-2 pt-1">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="text-xs text-gray-300 border border-gray-800 hover:border-trust-500/50 hover:text-white bg-gray-900/60 rounded-lg px-3 py-1.5 transition"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-gray-800 px-3 py-3 bg-gray-900/40"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Setu anything…"
              maxLength={1000}
              className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3.5 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-trust-400 transition"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              aria-label="Send message"
              className="bg-trust-600 hover:bg-trust-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg p-2.5 transition"
            >
              <SendHorizonal className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </form>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Launcher */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close Setu assistant" : "Open Setu assistant"}
        className="fixed bottom-6 right-4 sm:right-6 z-50 w-14 h-14 rounded-full bg-trust-600 hover:bg-trust-500 border border-trust-400/40 text-white flex items-center justify-center transition shadow-lg"
      >
        {open ? <X className="w-5 h-5" strokeWidth={1.75} /> : <MessageCircle className="w-5 h-5" strokeWidth={1.75} />}
      </button>
    </>
  );
}
