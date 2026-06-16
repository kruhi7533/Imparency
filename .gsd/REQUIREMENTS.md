# REQUIREMENTS.md

## User Authentication & Role Management
| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| REQ-01 | NextAuth.js setup supporting JWT strategy, Credentials provider (email/password), and Google OAuth. | SPEC User Roles | Complete |
| REQ-02 | Role-based authorization supporting `DONOR`, `NGO`, and `ADMIN` roles. | SPEC User Roles | Complete |
| REQ-03 | Role-based API route middleware preventing unauthorized access (e.g., donors cannot call NGO endpoints, NGOs cannot call Admin endpoints). | SPEC Constraints | Complete |
| REQ-04 | Rate limiting on authentication routes (login, registration, password reset). | SPEC Constraints | Complete |

## NGO Profile & Onboarding Workflow
| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| REQ-05 | NGO registration form collecting registration number, PAN, address, cause categories, website, founded year, description, and PDF document uploads (verification docs). | SPEC Goal 5 | Pending |
| REQ-06 | Admin verification dashboard allowing admins to view pending registrations, download submitted docs, and mark NGOs as `VERIFIED` or `REJECTED`. | SPEC Goal 5 | Pending |
| REQ-07 | Email confirmation sent to NGOs via Resend upon verification or rejection. | SPEC Goal 5 | Pending |

## Project & Milestone Builder
| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| REQ-08 | NGO project creation dashboard containing title, description, cause category, target amount, location, cover image upload, and milestone builder. | SPEC Goal 1 | Pending |
| REQ-09 | Milestone sequence builder allowing NGOs to specify a ordered chain of milestones with title, description, target amount, deadline, and proof type required. | SPEC Goal 1 | Pending |
| REQ-10 | Project Discovery page with filters by cause categories, location, NGO health score, and status (`ACTIVE`, `COMPLETED`). | SPEC Goal 3 | Pending |

## Payment Gateway & 80G Tax Receipt Generation
| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| REQ-11 | Razorpay gateway integration for secure donations via UPI, cards, and netbanking. | SPEC Goal 3 | Pending |
| REQ-12 | Razorpay webhook endpoint with signature verification for processing payment confirmations. | SPEC Constraints | Pending |
| REQ-13 | Automated PDF generation of 80G tax receipts using `@react-pdf/renderer` containing donation details, PAN, NGO details, registration numbers, and tax declarations. | SPEC Goal 3 | Pending |

## Milestone Proof Submission & Gemini AI Validation
| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| REQ-14 | Storage interface abstraction supporting Local File storage in development (uploading to `/public/uploads/`) and AWS S3/Cloudflare R2 in production. | SPEC Constraints | Complete |
| REQ-15 | NGO milestone completion form supporting image/document proof uploads (photos, receipts, reports) and descriptions. | SPEC Goal 1 | Pending |
| REQ-16 | Gemini API integration to analyze uploaded proof files against the milestone's specific objective, producing a validation score (0-100) and structured reasoning. | SPEC Goal 1 | Pending |
| REQ-17 | Automative validation handling: scores >= 70 mark milestone as `COMPLETED` and trigger reports; scores < 70 mark milestone as `PROOF_SUBMITTED` / `UNDER_REVIEW` and route to the Admin dashboard for override. | SPEC Goal 1 | Pending |

## Personalized Impact Reports & Notifications
| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| REQ-18 | Gemini-based impact narrative generator writing customized updates referencing the donor's exact contribution (e.g. "Your ₹2,000 bought 40 books..."). | SPEC Goal 1 | Pending |
| REQ-19 | Resend integration to dispatch personalized impact narrative reports to donors via email upon milestone completion. | SPEC Goal 1 | Pending |
| REQ-20 | Firebase Cloud Messaging (FCM) integration to trigger push notifications on mobile/browser for completed milestones, new projects, and donations. | SPEC Goal 1 | Pending |

## NGO Health Score Engine
| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| REQ-21 | Automated background engine to recalculate an NGO's Health Score based on fund utilization rate, milestone completion rate, proof submission speed, and donor return rate. | SPEC Goal 2 | Pending |
| REQ-22 | Recalculation triggers every time a project milestone status updates or a donation is completed. | SPEC Goal 2 | Pending |

## Portfolios & Dashboards
| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| REQ-23 | Donor Impact Portfolio dashboard displaying summary analytics (total donated, lives impacted), followed NGOs feed, active funded projects, and downloadable receipts. | SPEC Goal 3 | Pending |
| REQ-24 | NGO Public Profile page with public health score details, active/completed projects, historical milestones, and testimonials. | SPEC Goal 3 | Pending |
| REQ-25 | CSR Dashboard for corporate donors presenting consolidated impact reports, compliance-ready exports, and utilization certificates. | SPEC Goal 4 | Pending |
| REQ-26 | Admin Dashboard displaying platform-wide donation statistics, pending verifications, flagged milestone reviews, and fraud alerts. | SPEC Goal 5 | Pending |
