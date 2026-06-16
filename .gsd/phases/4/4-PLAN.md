---
phase: 4
plan: 4
wave: 2
gap_closure: false
---

# Plan 4.4: Notification Dispatcher & FCM Integration

## Objective
Configure next.config.mjs for firebase-admin, write the FCM notification dispatcher utility (with database logs fallback), deploy the browser service worker stub, and integrate all five specified notification triggers.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/phases/4/RESEARCH.md
- .gsd/DECISIONS.md
- prisma/schema.prisma
- lib/email.ts
- next.config.mjs

## Tasks

<task type="auto">
  <name>Build Notification Manager and Service Worker Stub</name>
  <files>
    next.config.mjs
    lib/notification.ts
    public/firebase-messaging-sw.js
  </files>
  <action>
    Steps:
    1. Install `firebase-admin` npm package.
    2. Add `firebase-admin` to `experimental.serverExternalPackages` inside `next.config.mjs`.
    3. Create `lib/notification.ts`:
       - Initialize `firebase-admin` cert using `process.env.FIREBASE_SERVICE_ACCOUNT` JSON string.
       - Implement `sendPushNotification(userId, title, body, data?): Promise<void>`.
       - Query user profile to see if they have an active FCM registration token (stub or database field, wait, check if User model has token. If user model doesn't have token, we can check or log it, or save registration tokens in `Notification` or User. Let's look: `schema.prisma` does not have an explicit `fcmToken` on `User`. We should add `fcmToken String?` to `User` or handle mock token logs. Let's add `fcmToken String?` to the `User` model, or handle mock logs directly if absent. Adding `fcmToken String?` to `User` via a db push or migration is very simple. Let's add it.
       - Always write an entry to the `Notification` table (`userId`, `type`, `title`, `body`, `read: false`) so they display in the in-app notification dropdown regardless of browser delivery.
       - Fallback: If `FIREBASE_SERVICE_ACCOUNT` is missing or in dev, log push payload to console: `[MOCK PUSH TO USER ${userId}]: ${title} - ${body}`.
    4. Create `public/firebase-messaging-sw.js` stub:
       - Implement fallback service worker loading scripts and setting up dummy background listener to prevent console errors.
  </action>
  <verify>
    Ensure script compiles cleanly.
  </verify>
  <done>
    Notification manager is fully created, stub service worker exists, and database push records are created.
  </done>
</task>

<task type="auto">
  <name>Integrate Push and Email Notification Triggers</name>
  <files>
    lib/notification-triggers.ts
    app/api/donations/webhook/route.ts
    app/api/ngo/submit-proof/route.ts
    app/api/admin/review-proof/route.ts
  </files>
  <action>
    Steps:
    1. Create `lib/notification-triggers.ts` grouping the triggers:
       - `triggerMilestoneCompleted(milestoneId)`: Sends push + email (with Gemini narrative) to all donors of the project.
       - `triggerProofApproved(milestoneId)`: Sends push + email to the NGO stating proof was approved.
       - `triggerProofRejected(milestoneId, reason)`: Sends push + email to the NGO stating proof was rejected with reason.
       - `triggerFollowedNGONewProject(ngoId, projectId)`: Sends push + email to all followers of the NGO.
       - `triggerNewDonationReceived(donationId)`: Sends push only (no email) to the NGO.
    2. Hook triggers into code paths:
       - `triggerNewDonationReceived` inside `/api/donations/webhook/route.ts` on success capture.
       - `triggerFollowedNGONewProject` inside project creation route if NGO publishes.
       - Milestone completion trigger inside `/api/ngo/submit-proof/route.ts` if score >= 70.
       - Admin approval/rejection triggers inside `/api/admin/review-proof/route.ts` on action completion.
  </action>
  <verify>
    Run a compiler check to ensure all triggers compile cleanly.
  </verify>
  <done>
    All 5 notification triggers are successfully integrated into code paths and emit appropriate push and email notifications.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] In-app `Notification` record is created for every dispatch.
- [ ] Rejection alerts include the admin's written reason.
- [ ] New donation notifications are push-only (no emails).

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] No regressions in tests
