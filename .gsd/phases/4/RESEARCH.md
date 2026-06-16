# Phase 4 Research: Gemini Proof Validation & Impact Narratives

## 1. Gemini API Integration via `@google/genai`

### Modern SDK Usage
The modern `@google/genai` SDK is Google's unified library for generative models.
- **Initialization:**
  ```typescript
  import { GoogleGenAI } from "@google/genai";
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  ```
- **Multimodal Payload:**
  To evaluate uploaded files (images or PDFs) alongside text descriptions, we read the local files into Buffers and pass them as inline base64 data to the API:
  ```typescript
  const inlineFile = {
    inlineData: {
      data: buffer.toString("base64"),
      mimeType: "image/jpeg" // or "application/pdf"
    }
  };
  ```
- **Structured JSON Validation:**
  We configure `responseSchema` to guarantee structured JSON output from Gemini:
  ```typescript
  import { Type } from "@google/genai";
  
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [prompt, ...inlineFiles],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.INTEGER },
          reasoning: { type: Type.STRING },
          flags: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING } 
          },
          suggestion: { type: Type.STRING }
        },
        required: ["score", "reasoning", "flags"]
      }
    }
  });
  ```

## 2. Firebase Cloud Messaging (FCM) Integration

### Server-Side SDK
We utilize `firebase-admin` to send push notifications.
- **Initialization:**
  We configure basic authentication via the Firebase service account JSON environment variable (`FIREBASE_SERVICE_ACCOUNT`):
  ```typescript
  import admin from "firebase-admin";
  
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
    if (serviceAccount.projectId) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
  }
  ```
- **Sending Push Notifications:**
  We use `messaging().send` or `sendMulticast` to target specific donor tokens:
  ```typescript
  const message = {
    token: userFcmToken,
    notification: {
      title: "Milestone Completed!",
      body: "An NGO you fund just completed a milestone."
    },
    data: {
      url: `/projects/${projectId}`
    }
  };
  await admin.messaging().send(message);
  ```

### Client-Side Service Worker Stub
To prevent JavaScript errors in the browser when attempting to register background messaging handlers, we must place a basic stub service worker at `public/firebase-messaging-sw.js`:
```javascript
// public/firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

// Stub configuration
firebase.initializeApp({
  apiKey: "mock-api-key",
  authDomain: "mock.firebaseapp.com",
  projectId: "mock-project-id",
  storageBucket: "mock.appspot.com",
  messagingSenderId: "123456789",
  appId: "mock-app-id"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log("Background message received: ", payload);
});
```
