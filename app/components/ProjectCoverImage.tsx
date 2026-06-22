"use client";

import React, { useState } from "react";
import { Book, Heart, Leaf, Lightbulb, Soup, Users, HelpCircle } from "lucide-react";

interface ProjectCoverImageProps {
  src?: string;
  alt: string;
  causeCategory: string;
  className?: string;
}

export default function ProjectCoverImage({
  src,
  alt,
  causeCategory,
  className = "w-full h-full object-cover object-center",
}: ProjectCoverImageProps) {
  const [error, setError] = useState(false);

  const getFallbackIcon = (category: string) => {
    switch (category) {
      case "Education":
        return <Book className="w-8 h-8" />;
      case "Healthcare":
        return <Heart className="w-8 h-8" />;
      case "Environment":
        return <Leaf className="w-8 h-8" />;
      case "Rural Development":
        return <Lightbulb className="w-8 h-8" />;
      case "Hunger":
        return <Soup className="w-8 h-8" />;
      case "Women Empowerment":
        return <Users className="w-8 h-8" />;
      default:
        return <HelpCircle className="w-8 h-8" />;
    }
  };

  const getFallbackGradient = (category: string) => {
    switch (category) {
      case "Education":
        return "from-blue-600 to-indigo-500 text-blue-100";
      case "Healthcare":
        return "from-rose-500 to-coral-400 text-rose-100";
      case "Environment":
        return "from-emerald-600 to-teal-500 text-emerald-100";
      case "Women Empowerment":
        return "from-purple-600 to-fuchsia-500 text-purple-100";
      case "Rural Development":
        return "from-indigo-600 to-violet-500 text-indigo-100";
      case "Hunger":
        return "from-amber-500 to-orange-500 text-amber-100";
      default:
        return "from-gray-600 to-slate-500 text-gray-100";
    }
  };

  if (error || !src) {
    const gradient = getFallbackGradient(causeCategory);
    return (
      <div className={`w-full h-full bg-gradient-to-br ${gradient} flex flex-col items-center justify-center gap-2 p-4 select-none`}>
        {getFallbackIcon(causeCategory)}
        <span className="text-[10px] font-black uppercase tracking-wider opacity-90 text-center line-clamp-1">
          {causeCategory}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setError(true)}
    />
  );
}
