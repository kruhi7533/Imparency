import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getMessaging, Message } from "firebase-admin/messaging";
import prisma from "@/lib/prisma";

let isFirebaseInitialized = false;

function initializeFirebase() {
  if (isFirebaseInitialized) return true;
  if (getApps().length > 0) {
    isFirebaseInitialized = true;
    return true;
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) {
    console.warn("FIREBASE_SERVICE_ACCOUNT env variable is missing. FCM push notifications will run in Mock Mode.");
    return false;
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    initializeApp({
      credential: cert(serviceAccount),
    });
    isFirebaseInitialized = true;
    console.log("Firebase Admin successfully initialized.");
    return true;
  } catch (error) {
    console.error("Failed to initialize Firebase Admin SDK:", error);
    return false;
  }
}

export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  // 1. Create in-app Notification record in DB
  try {
    await prisma.notification.create({
      data: {
        userId,
        type: "PUSH",
        title,
        body,
        read: false,
      },
    });
  } catch (dbErr) {
    console.error(`Failed to save in-app notification to DB for user ${userId}:`, dbErr);
  }

  // 2. Retrieve user and their FCM Token
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fcmToken: true },
  });

  if (!user?.fcmToken) {
    console.log(`[MOCK PUSH TO USER ${userId} (No Token)]: ${title} - ${body}`);
    return;
  }

  // 3. Try to deliver push notification via FCM or Mock
  const hasFirebase = initializeFirebase();
  if (!hasFirebase) {
    console.log(`[MOCK PUSH TO USER ${userId} (Token: ${user.fcmToken})]: ${title} - ${body}`);
    return;
  }

  try {
    const message: Message = {
      token: user.fcmToken,
      notification: {
        title,
        body,
      },
      data: data || {},
    };

    const response = await getMessaging().send(message);
    console.log(`Successfully sent FCM message to user ${userId}:`, response);
  } catch (error: any) {
    console.error(`Error sending FCM message to user ${userId}:`, error);
    // If the token is invalid or inactive, clear it from the database
    if (
      error.code === "messaging/invalid-registration-token" ||
      error.code === "messaging/registration-token-not-registered"
    ) {
      console.log(`Clearing inactive/invalid FCM token for user ${userId}`);
      try {
        await prisma.user.update({
          where: { id: userId },
          data: { fcmToken: null },
        });
      } catch (updateErr) {
        console.error("Failed to clear invalid FCM token:", updateErr);
      }
    }
  }
}
