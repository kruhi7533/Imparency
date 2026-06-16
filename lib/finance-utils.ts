const singleDigits = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const doubleDigits = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const tensDigits = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function convertLessThanThousand(n: number): string {
  let str = "";
  if (n >= 100) {
    str += singleDigits[Math.floor(n / 100)] + " Hundred ";
    n %= 100;
  }
  if (n >= 10 && n < 20) {
    str += doubleDigits[n - 10] + " ";
  } else {
    if (n >= 20) {
      str += tensDigits[Math.floor(n / 10)] + " ";
      n %= 10;
    }
    if (n > 0) {
      str += singleDigits[n] + " ";
    }
  }
  return str.trim();
}

/**
 * Converts a number into Indian currency words format.
 * E.g., 2500 -> "Rupees Two Thousand Five Hundred Only"
 * E.g., 150000 -> "Rupees One Lakh Fifty Thousand Only"
 */
export function amountToWords(amount: number): string {
  const integerPart = Math.floor(amount);
  if (integerPart === 0) return "Rupees Zero Only";
  
  let temp = integerPart;
  
  const crores = Math.floor(temp / 10000000);
  temp %= 10000000;
  
  const lakhs = Math.floor(temp / 100000);
  temp %= 100000;
  
  const thousands = Math.floor(temp / 1000);
  temp %= 1000;
  
  const hundreds = temp;
  
  let words = "";
  if (crores > 0) {
    words += convertLessThanThousand(crores) + " Crore ";
  }
  if (lakhs > 0) {
    words += convertLessThanThousand(lakhs) + " Lakh ";
  }
  if (thousands > 0) {
    words += convertLessThanThousand(thousands) + " Thousand ";
  }
  if (hundreds > 0) {
    words += convertLessThanThousand(hundreds);
  }
  
  const cleanWords = words.trim().replace(/\s+/g, " ");
  return `Rupees ${cleanWords} Only`;
}

/**
 * Calculates the Indian Financial Year for a given date.
 * E.g., June 2026 -> "2026-27"
 * E.g., Jan 2026 -> "2025-26"
 */
export function getIndianFinancialYear(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed: April is 3
  if (month >= 3) {
    const nextYearShort = String(year + 1).slice(-2);
    return `${year}-${nextYearShort}`;
  } else {
    const yearShort = String(year).slice(-2);
    return `${year - 1}-${yearShort}`;
  }
}
