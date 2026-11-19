import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyTextToClipboard } from "../utils/promptBuilder";

interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  variant?: "primary" | "secondary" | "subtle";
  className?: string;
}

export function CopyButton({
  text,
  label = "Copy Prompt",
  copiedLabel = "Copied",
  variant = "primary",
  className = "",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };

  const baseStyles =
    "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A8A] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

  const variantStyles =
    variant === "primary"
      ? copied
        ? "bg-[#14532D] text-[#FBF9F5] px-4 py-2 text-sm rounded-md"
        : "bg-[#1E3A8A] hover:bg-[#172D6B] text-[#FBF9F5] px-4 py-2 text-sm rounded-md"
      : variant === "secondary"
        ? copied
          ? "bg-[#14532D]/10 text-[#14532D] border border-[#14532D]/30 px-3.5 py-2 text-xs rounded-md"
          : "bg-white hover:bg-stone-100 text-stone-900 border border-stone-300 px-3.5 py-2 text-xs rounded-md"
        : copied
          ? "text-[#14532D] px-2.5 py-1.5 text-xs rounded"
          : "text-stone-700 hover:text-stone-950 hover:bg-stone-200/60 px-2.5 py-1.5 text-xs rounded";

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!text.trim()}
      aria-live="polite"
      className={`${baseStyles} ${variantStyles} ${className}`}
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Copy className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      )}
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
}
