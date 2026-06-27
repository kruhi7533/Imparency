/**
 * Converts a whole number up to 99,99,999 (99 Lakhs) to Indian word format.
 */
function convertWholeNumberToWords(n: number): string {
  if (n === 0) return "";
  
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen"
  ];
  
  const tens = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"
  ];

  const convertLessThanThousand = (num: number): string => {
    let str = "";
    if (num >= 100) {
      str += ones[Math.floor(num / 100)] + " Hundred";
      num %= 100;
      if (num > 0) str += " ";
    }
    if (num >= 20) {
      str += tens[Math.floor(num / 20)];
      num %= 20;
      if (num > 0) str += " " + ones[num];
    } else if (num > 0) {
      str += ones[num];
    }
    return str;
  };

  let result = "";
  
  // Lakhs (1,00,000 to 99,99,999)
  if (n >= 100000) {
    const lakhs = Math.floor(n / 100000);
    result += convertLessThanThousand(lakhs) + " Lakh";
    n %= 100000;
    if (n > 0) result += " ";
  }
  
  // Thousands (1,000 to 99,999)
  if (n >= 1000) {
    const thousands = Math.floor(n / 1000);
    result += convertLessThanThousand(thousands) + " Thousand";
    n %= 1000;
    if (n > 0) result += " ";
  }
  
  // Remaining < 1000
  if (n > 0) {
    result += convertLessThanThousand(n);
  }
  
  return result.trim();
}

/**
 * Converts a decimal amount to Indian-locale words (Rupees and Paise).
 * Handles values up to Lakhs.
 */
export function numberToIndianWords(amount: number): string {
  if (amount <= 0) return "Zero Rupees Only";
  
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);

  const rupeesStr = convertWholeNumberToWords(rupees);
  const paiseStr = convertWholeNumberToWords(paise);

  if (rupeesStr && paiseStr) {
    return `${rupeesStr} and ${paiseStr} Paise Only`;
  } else if (rupeesStr) {
    return `${rupeesStr} Rupees Only`;
  } else if (paiseStr) {
    return `${paiseStr} Paise Only`;
  }
  return "Zero Rupees Only";
}

/**
 * Returns the Indian financial year string in format "YYYY-YY" based on a date.
 * (April 1 to March 31 of the next calendar year).
 */
export function getFinancialYear(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0 = Jan, 1 = Feb, 2 = Mar, 3 = Apr, ...
  
  let startYear = year;
  if (month < 3) { // Jan, Feb, Mar belong to previous financial year
    startYear = year - 1;
  }
  
  const endYear = (startYear + 1) % 100;
  const endYearStr = endYear.toString().padStart(2, "0");
  
  return `${startYear}-${endYearStr}`;
}

export const getIndianFinancialYear = getFinancialYear;

/**
 * Generates a formatted unique tax receipt number.
 * Format: IMP/{financialYear}/{sequence padded to 5 digits}
 */
export function generateReceiptNumber(sequence: number, financialYear: string): string {
  const paddedSequence = sequence.toString().padStart(5, "0");
  return `IMP/${financialYear}/${paddedSequence}`;
}
