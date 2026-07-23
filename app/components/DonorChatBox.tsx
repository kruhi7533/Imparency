"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";

interface Message {
  id: string;
  senderId: string;
  senderRole: "DONOR" | "NGO";
  body: string;
  createdAt: string;
}

interface DonorChatBoxProps {
  ngoId: string;
  ngoName: string;
  isAuthenticated: boolean;
}

export default function DonorChatBox({ ngoId, ngoName, isAuthenticated }: DonorChatBoxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Poll for new messages when open
  useEffect(() => {
    if (!isOpen || !isAuthenticated) return;

    const fetchInquiry = async () => {
      try {
        const res = await fetch(`/api/ngo/${ngoId}/inquiry`);
        if (res.ok) {
          const data = await res.json();
          if (data.inquiry?.messages) {
            setMessages(data.inquiry.messages);
          }
        }
      } catch (err) {
        console.error("Error fetching chat messages:", err);
      }
    };

    fetchInquiry();
    const interval = setInterval(fetchInquiry, 4000);
    return () => clearInterval(interval);
  }, [isOpen, ngoId, isAuthenticated]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || loading) return;

    const bodyText = inputText.trim();
    setInputText("");
    setLoading(true);
    setError("");

    // Optimistic UI update
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: Message = {
      id: tempId,
      senderId: "temp-sender",
      senderRole: "DONOR",
      body: bodyText,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    try {
      const res = await fetch(`/api/ngo/${ngoId}/inquiry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: bodyText }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to send message");
      }

      const data = await res.json();
      if (data.inquiry?.messages) {
        setMessages(data.inquiry.messages);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Could not send message");
      // Remove optimistic message on failure
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 font-sans">
      {/* Floating Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full flex items-center justify-center shadow-lg transition-all transform hover:scale-105 active:scale-95 focus:outline-none"
        title={`Chat with ${ngoName}`}
      >
        {isOpen ? (
          <span className="text-2xl font-bold">✕</span>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
          </svg>
        )}
      </button>

      {/* Chat Window Panel */}
      {isOpen && (
        <div className="absolute bottom-20 right-0 w-80 sm:w-96 h-[480px] bg-white dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-200">
          
          {/* Header */}
          <div className="bg-emerald-600 px-6 py-4 flex justify-between items-center text-white">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center font-bold text-lg">
                {ngoName.charAt(0)}
              </div>
              <div className="text-left">
                <h3 className="font-extrabold text-sm leading-tight line-clamp-1">{ngoName}</h3>
                <span className="text-[10px] text-emerald-150 flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 bg-emerald-300 rounded-full animate-ping"></span>
                  Inquiry Chatbox
                </span>
              </div>
            </div>
          </div>

          {/* Messages / Auth Box */}
          <div className="flex-1 overflow-y-auto p-5 bg-gray-50/50 dark:bg-gray-950/20 space-y-4">
            {!isAuthenticated ? (
              <div className="h-full flex flex-col justify-center items-center text-center p-6 space-y-4">
                <div className="w-14 h-14 bg-gray-100 dark:bg-gray-800 text-gray-400 rounded-full flex items-center justify-center">
                  🔑
                </div>
                <div className="space-y-1.5">
                  <h4 className="font-bold text-gray-800 dark:text-white text-sm">Authentication Required</h4>
                  <p className="text-xs text-gray-500">Log in as a donor to start chatting with {ngoName}.</p>
                </div>
                <Link
                  href="/login"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-6 py-2.5 rounded-xl text-xs shadow transition"
                >
                  Log In
                </Link>
              </div>
            ) : (
              <>
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col justify-center items-center text-center p-6 text-gray-400">
                    <p className="text-xs leading-relaxed font-medium">
                      👋 Have questions about this NGO, their cause, or fund utilization? 
                    </p>
                    <p className="text-[10px] mt-1.5">Type your message below to start the conversation.</p>
                  </div>
                ) : (
                  messages.map((m) => {
                    const isDonor = m.senderRole === "DONOR";
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isDonor ? "items-end" : "items-start"}`}
                      >
                        <div
                          className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-xs font-medium shadow-sm leading-relaxed ${
                            isDonor
                              ? "bg-emerald-600 text-white rounded-tr-none text-right"
                              : "bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-850 text-gray-800 dark:text-gray-200 rounded-tl-none text-left"
                          }`}
                        >
                          {m.body}
                        </div>
                        <span className="text-[8px] text-gray-400 mt-1 px-1">
                          {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Footer Input Form */}
          {isAuthenticated && (
            <form onSubmit={handleSendMessage} className="p-3.5 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2 bg-white dark:bg-gray-900">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Ask a question..."
                className="flex-1 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-2 text-xs dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
              />
              <button
                type="submit"
                disabled={!inputText.trim() || loading}
                className="bg-emerald-600 hover:bg-emerald-700 text-white p-2 rounded-xl transition disabled:opacity-50 flex items-center justify-center"
              >
                <svg className="w-4 h-4 transform rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
                </svg>
              </button>
            </form>
          )}

          {error && (
            <div className="absolute bottom-16 left-4 right-4 p-2 bg-red-50 border border-red-150 rounded-lg text-[10px] text-red-600 text-center animate-bounce">
              {error}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
