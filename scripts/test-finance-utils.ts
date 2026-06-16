import { amountToWords, getIndianFinancialYear } from "../lib/finance-utils";

function assertEqual(actual: any, expected: any, message: string) {
  if (actual !== expected) {
    throw new Error(`FAIL: ${message}\nExpected: "${expected}"\nActual:   "${actual}"`);
  }
  console.log(`PASS: ${message}`);
}

console.log("Starting financial utils test suite...");

// Test getIndianFinancialYear
assertEqual(getIndianFinancialYear(new Date("2026-06-17")), "2026-27", "Financial year for June 2026");
assertEqual(getIndianFinancialYear(new Date("2026-03-15")), "2025-26", "Financial year for March 2026");
assertEqual(getIndianFinancialYear(new Date("2026-04-01")), "2026-27", "Financial year for April 1st, 2026");
assertEqual(getIndianFinancialYear(new Date("2026-12-31")), "2026-27", "Financial year for Dec 31st, 2026");

// Test amountToWords
assertEqual(amountToWords(0), "Rupees Zero Only", "Zero rupees");
assertEqual(amountToWords(5), "Rupees Five Only", "Single digit");
assertEqual(amountToWords(15), "Rupees Fifteen Only", "Teen digit");
assertEqual(amountToWords(45), "Rupees Forty Five Only", "Double digit");
assertEqual(amountToWords(100), "Rupees One Hundred Only", "Hundreds");
assertEqual(amountToWords(2500), "Rupees Two Thousand Five Hundred Only", "Thousands");
assertEqual(amountToWords(100000), "Rupees One Lakh Only", "One Lakh");
assertEqual(amountToWords(150000), "Rupees One Lakh Fifty Thousand Only", "Lakhs and thousands");
assertEqual(amountToWords(10000000), "Rupees One Crore Only", "One Crore");
assertEqual(amountToWords(15300201), "Rupees One Crore Fifty Three Lakh Two Hundred One Only", "Complex crores");

console.log("All tests passed successfully!");
