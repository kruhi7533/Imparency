// public/firebase-messaging-sw.js
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");

self.addEventListener("install", (event) => {
  console.log("Firebase Messaging Service Worker installed.");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("Firebase Messaging Service Worker activated.");
});

self.addEventListener("push", (event) => {
  if (event.data) {
    try {
      const payload = event.data.json();
      console.log("Background Message received: ", payload);
      
      const notificationTitle = payload.notification?.title || "ImpactBridge Update";
      const notificationOptions = {
        body: payload.notification?.body || "",
        icon: "/favicon.ico",
        data: payload.data || {},
      };

      event.waitUntil(
        self.registration.showNotification(notificationTitle, notificationOptions)
      );
    } catch (e) {
      console.warn("Could not parse push event data as JSON, falling back to basic display:", e);
      event.waitUntil(
        self.registration.showNotification("ImpactBridge Update", {
          body: event.data.text()
        })
      );
    }
  }
});
