"use client";

import React, { useState, useRef, useEffect } from "react";

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  min?: string; // YYYY-MM-DD
  placeholder?: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export default function DatePicker({ value, onChange, min, placeholder = "Select date" }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  // Parse initial values
  const parsedDate = value ? new Date(value) : null;
  const initialYear = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate.getFullYear() : new Date().getFullYear();
  const initialMonth = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate.getMonth() : new Date().getMonth();

  const [currentMonth, setCurrentMonth] = useState(initialMonth);
  const [currentYear, setCurrentYear] = useState(initialYear);

  const containerRef = useRef<HTMLDivElement>(null);

  // Sync state if value changes externally
  useEffect(() => {
    if (value) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        setCurrentMonth(d.getMonth());
        setCurrentYear(d.getFullYear());
      }
    }
  }, [value]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();

  const pad = (num: number) => String(num).padStart(2, "0");

  const formatDateString = (year: number, month: number, day: number) => {
    return `${year}-${pad(month + 1)}-${pad(day)}`;
  };

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((prev) => prev - 1);
    } else {
      setCurrentMonth((prev) => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((prev) => prev + 1);
    } else {
      setCurrentMonth((prev) => prev + 1);
    }
  };

  const handleDaySelect = (day: number) => {
    const selectedDateStr = formatDateString(currentYear, currentMonth, day);
    
    // Validate min constraint
    if (min && selectedDateStr < min) {
      return;
    }
    
    onChange(selectedDateStr);
    setIsOpen(false);
  };

  // Render cells
  const blanks = Array(firstDayIndex).fill(null);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const cells = [...blanks, ...days];

  // Helper to format date display in the button
  const getDisplayDate = () => {
    if (!value) return placeholder;
    const d = new Date(value);
    if (isNaN(d.getTime())) return placeholder;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-left transition"
      >
        <span className={!value ? "text-gray-400 dark:text-gray-500" : ""}>{getDisplayDate()}</span>
        <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-1.5 w-64 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl p-4 z-50 transition-all duration-150 animate-in fade-in zoom-in-95">
          {/* Header */}
          <div className="flex justify-between items-center mb-3">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-850 rounded-lg transition text-gray-600 dark:text-gray-400"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-xs font-extrabold text-gray-900 dark:text-white">
              {MONTHS[currentMonth]} {currentYear}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-850 rounded-lg transition text-gray-600 dark:text-gray-400"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Weekdays */}
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-gray-400 dark:text-gray-500 mb-1">
            {WEEKDAYS.map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell, idx) => {
              if (cell === null) {
                return <div key={`empty-${idx}`} />;
              }

              const dateStr = formatDateString(currentYear, currentMonth, cell);
              const isSelected = value === dateStr;
              const isPast = min ? dateStr < min : false;

              return (
                <button
                  key={`day-${cell}`}
                  type="button"
                  disabled={isPast}
                  onClick={() => handleDaySelect(cell)}
                  className={`h-7 w-7 text-xs font-semibold rounded-lg flex items-center justify-center transition ${
                    isSelected
                      ? "bg-emerald-600 text-white font-extrabold"
                      : isPast
                      ? "text-gray-300 dark:text-gray-700 cursor-not-allowed"
                      : "text-gray-700 dark:text-gray-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 hover:text-emerald-600 dark:hover:text-emerald-400"
                  }`}
                >
                  {cell}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
