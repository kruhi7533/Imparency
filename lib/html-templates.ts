import { NextResponse } from "next/server";

export function renderDecisionPage({
  status,
  title,
  message,
}: {
  status: "success" | "error" | "info";
  title: string;
  message: string;
}) {
  const icon = status === "success" ? "✓" : status === "error" ? "✕" : "ℹ";
  const iconClass = status === "success" ? "success-icon" : status === "error" ? "error-icon" : "info-icon";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Imparency</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet">
  <style>
    body {
      background-color: #0b0f19;
      color: #f3f4f6;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background-color: #111827;
      border: 1px solid #1f2937;
      border-radius: 24px;
      padding: 40px;
      max-width: 420px;
      width: 90%;
      text-align: center;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4);
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: '';
      position: absolute;
      top: -100px;
      left: -100px;
      width: 200px;
      height: 200px;
      background: radial-gradient(circle, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0) 70%);
      pointer-events: none;
    }
    .icon-container {
      width: 72px;
      height: 72px;
      margin: 0 auto 24px auto;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
    }
    .success-icon {
      background-color: rgba(16, 185, 129, 0.1);
      border: 2px solid #10b981;
      color: #10b981;
      box-shadow: 0 0 20px rgba(16, 185, 129, 0.2);
    }
    .error-icon {
      background-color: rgba(239, 68, 68, 0.1);
      border: 2px solid #ef4444;
      color: #ef4444;
      box-shadow: 0 0 20px rgba(239, 68, 68, 0.2);
    }
    .info-icon {
      background-color: rgba(59, 130, 246, 0.1);
      border: 2px solid #3b82f6;
      color: #3b82f6;
      box-shadow: 0 0 20px rgba(59, 130, 246, 0.2);
    }
    h1 {
      margin: 0 0 12px 0;
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.5px;
    }
    p {
      margin: 0 0 24px 0;
      font-size: 14px;
      line-height: 1.6;
      color: #9ca3af;
    }
    .close-hint {
      display: inline-block;
      font-size: 12px;
      font-weight: 600;
      color: #6b7280;
      border-top: 1px solid #1f2937;
      padding-top: 16px;
      width: 100%;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-container ${iconClass}">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="close-hint">You may now close this tab safely.</div>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
