import { describe, it, expect } from "vitest";
import {
  numberToIndianWords,
  getFinancialYear,
  generateReceiptNumber,
} from "@/lib/finance-utils";

describe("numberToIndianWords", () => {
  it("handles zero and negative amounts", () => {
    expect(numberToIndianWords(0)).toBe("Zero Rupees Only");
    expect(numberToIndianWords(-5)).toBe("Zero Rupees Only");
  });

  it("converts single digits and teens", () => {
    expect(numberToIndianWords(1)).toBe("One Rupees Only");
    expect(numberToIndianWords(9)).toBe("Nine Rupees Only");
    expect(numberToIndianWords(13)).toBe("Thirteen Rupees Only");
    expect(numberToIndianWords(19)).toBe("Nineteen Rupees Only");
  });

  it("converts round tens", () => {
    expect(numberToIndianWords(20)).toBe("Twenty Rupees Only");
    expect(numberToIndianWords(30)).toBe("Thirty Rupees Only");
    expect(numberToIndianWords(40)).toBe("Forty Rupees Only");
    expect(numberToIndianWords(90)).toBe("Ninety Rupees Only");
  });

  it("converts compound tens", () => {
    expect(numberToIndianWords(21)).toBe("Twenty One Rupees Only");
    expect(numberToIndianWords(45)).toBe("Forty Five Rupees Only");
    expect(numberToIndianWords(78)).toBe("Seventy Eight Rupees Only");
    expect(numberToIndianWords(99)).toBe("Ninety Nine Rupees Only");
  });

  it("converts hundreds", () => {
    expect(numberToIndianWords(100)).toBe("One Hundred Rupees Only");
    expect(numberToIndianWords(101)).toBe("One Hundred One Rupees Only");
    expect(numberToIndianWords(550)).toBe("Five Hundred Fifty Rupees Only");
    expect(numberToIndianWords(999)).toBe("Nine Hundred Ninety Nine Rupees Only");
  });

  it("converts thousands (Indian grouping)", () => {
    expect(numberToIndianWords(1000)).toBe("One Thousand Rupees Only");
    expect(numberToIndianWords(1234)).toBe(
      "One Thousand Two Hundred Thirty Four Rupees Only"
    );
    expect(numberToIndianWords(50000)).toBe("Fifty Thousand Rupees Only");
    expect(numberToIndianWords(99999)).toBe(
      "Ninety Nine Thousand Nine Hundred Ninety Nine Rupees Only"
    );
  });

  it("converts lakhs", () => {
    expect(numberToIndianWords(100000)).toBe("One Lakh Rupees Only");
    expect(numberToIndianWords(150000)).toBe("One Lakh Fifty Thousand Rupees Only");
    expect(numberToIndianWords(9999999)).toBe(
      "Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine Rupees Only"
    );
  });

  it("includes paise when present", () => {
    expect(numberToIndianWords(500.5)).toBe(
      "Five Hundred and Fifty Paise Only"
    );
    expect(numberToIndianWords(1.25)).toBe("One and Twenty Five Paise Only");
    expect(numberToIndianWords(0.75)).toBe("Seventy Five Paise Only");
  });
});

describe("getFinancialYear", () => {
  it("uses the calendar year for April onwards", () => {
    expect(getFinancialYear(new Date(2025, 3, 1))).toBe("2025-26"); // Apr 1
    expect(getFinancialYear(new Date(2025, 11, 31))).toBe("2025-26"); // Dec 31
  });

  it("uses the previous year for January through March", () => {
    expect(getFinancialYear(new Date(2026, 0, 1))).toBe("2025-26"); // Jan 1
    expect(getFinancialYear(new Date(2026, 2, 31))).toBe("2025-26"); // Mar 31
  });

  it("rolls over exactly at April 1", () => {
    expect(getFinancialYear(new Date(2026, 2, 31))).toBe("2025-26");
    expect(getFinancialYear(new Date(2026, 3, 1))).toBe("2026-27");
  });

  it("pads the end year to two digits", () => {
    expect(getFinancialYear(new Date(2099, 5, 15))).toBe("2099-00");
    expect(getFinancialYear(new Date(2005, 5, 15))).toBe("2005-06");
  });
});

describe("generateReceiptNumber", () => {
  it("formats as IMP/{FY}/{5-digit sequence}", () => {
    expect(generateReceiptNumber(1, "2025-26")).toBe("IMP/2025-26/00001");
    expect(generateReceiptNumber(42, "2025-26")).toBe("IMP/2025-26/00042");
    expect(generateReceiptNumber(99999, "2025-26")).toBe("IMP/2025-26/99999");
  });

  it("does not truncate sequences beyond five digits", () => {
    expect(generateReceiptNumber(123456, "2025-26")).toBe("IMP/2025-26/123456");
  });
});
