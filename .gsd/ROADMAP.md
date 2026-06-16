# ROADMAP.md

> **Current Phase**: Phase 5: Health Score Engine, CSR & Polish (Complete)
> **Milestone**: v1.0

## Must-Haves (from SPEC)
- [x] Role-based NextAuth.js authentication (DONOR, NGO, ADMIN)
- [x] NGO document upload & Admin verification dashboard
- [x] Project & Milestone sequence builder
- [x] Razorpay payment integration with webhook validation
- [x] Serverless-friendly 80G tax receipt PDF auto-generation
- [x] Storage abstraction with local upload and S3/R2 support
- [x] Gemini API milestone proof validation (with admin manual override)
- [x] Gemini-generated personalized donor impact narratives
- [x] Resend email and FCM push notifications for milestone updates
- [x] Automated NGO Health Score recalculation engine
- [x] Donor Impact Portfolio, NGO Discovery with filtering, and NGO Public Profiles
- [x] CSR Corporate Dashboard and comprehensive Admin Panel

## Phases

### Phase 1: Database Foundation, Auth & Storage Adapter
**Status**: ✅ Complete
**Objective**: Setup the database schema, multi-role NextAuth.js authentication system, role-based middlewares, and the hybrid local/S3 file storage utility.
**Requirements**: REQ-01, REQ-02, REQ-03, REQ-04, REQ-14

### Phase 2: NGO Profiles, Onboarding & Projects
**Status**: ✅ Complete
**Objective**: Develop the NGO registration workflow, Admin document review panel, and the Project & Milestone sequence creation dashboards, alongside discovery and profile pages.
**Requirements**: REQ-05, REQ-06, REQ-07, REQ-08, REQ-09, REQ-10, REQ-24

### Phase 3: Donations & 80G Tax Receipts
**Status**: ✅ Complete
**Objective**: Implement Razorpay checkout flow, secure webhook signature verification, dynamic `@react-pdf/renderer` 80G tax receipts, and the donor impact dashboard.
**Requirements**: REQ-11, REQ-12, REQ-13, REQ-23

### Phase 4: Gemini Proof Validation & Impact Narratives
**Status**: ✅ Complete
**Objective**: Build proof submission interfaces, integrate Gemini API for automatic proof analysis and score evaluation, construct the Admin override dashboard, and deploy Resend/FCM notification flows.
**Requirements**: REQ-15, REQ-16, REQ-17, REQ-18, REQ-19, REQ-20

### Phase 5: Health Score Engine, CSR & Polish
**Status**: ✅ Complete
**Objective**: Build the NGO Health Score recalculation engine, the CSR Corporate dashboard, platform-wide analytics/fraud controls, and complete UI polish (skeleton states, error handling, mobile responsiveness).
**Requirements**: REQ-21, REQ-22, REQ-25, REQ-26
