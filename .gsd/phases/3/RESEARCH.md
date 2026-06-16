# Phase 3 Research: Donations & 80G Tax Receipts

## Razorpay Integration

### Order Creation
Before the client triggers the checkout popup, we must create a server-side order using the Razorpay Node.js SDK (or raw fetch requests to Razorpay APIs). 
- API Endpoint: `https://api.razorpay.com/v1/orders`
- Method: `POST`
- Payload: `{ amount: amountInPaise, currency: "INR", receipt: donationId }`
- Auth: Basic Auth using `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.

### Webhook Validation
Razorpay dispatches webhooks when payments are captured (`payment.captured`) or orders are paid (`order.paid`).
- Header: `x-razorpay-signature`
- Signature validation:
  ```typescript
  import crypto from "crypto";
  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");
  ```
- If the signature matches `x-razorpay-signature`, the payload is verified as authentic.

## @react-pdf/renderer in Next.js 14 App Router

### Serverless Environment Constraints
`@react-pdf/renderer` depends on Node APIs and native layouts (e.g., yoga-layout) that do not compile correctly under Edge runtime.
- **Resolution:** Force all PDF routes to run on the Node.js runtime:
  ```typescript
  export const runtime = "nodejs";
  ```
- **Next Config:** Add `@react-pdf/renderer` to `experimental.serverExternalPackages` inside `next.config.mjs` to prevent Next.js from attempting to bundle it for Edge runtimes:
  ```javascript
  experimental: {
    serverExternalPackages: ['@react-pdf/renderer']
  }
  ```

## Financial Utilities (`lib/finance-utils.ts`)

### Indian Financial Year
In India, the financial year runs from April 1st to March 31st.
```typescript
export function getIndianFinancialYear(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed (April is 3)
  if (month >= 3) {
    return `${year}-${String(year + 1).slice(-2)}`;
  } else {
    return `${year - 1}-${String(year).slice(-2)}`;
  }
}
```

### Amount to Words (Indian Numbering System)
Under the Indian numbering system, values are grouped by Lakhs and Crores (e.g., 2,00,000 is "Two Lakh Rupees").
```typescript
export function amountToWords(amount: number): string {
  // Convert integer part of amount to words in Indian format (Rupees ... Only)
  // Logic should process units, tens, hundreds, thousands, lakhs, crores.
}
```
