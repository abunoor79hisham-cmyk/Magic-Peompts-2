import { useRef, useState } from "react";
import { ImagePlus, Link2, Loader2, Upload, X } from "lucide-react";
import { analyzeImageLocally } from "../utils/localImageAnalyzer";
import { prepareImageForUpload } from "../utils/promptBuilder";
import { CopyButton } from "./CopyButton";

interface DecodedStyleResult {
  title: string;
  detectedMovement: string;
  mediumAndSurface: string;
  detectedEffects?: string[];
  typographyAndFonts?: string;
  characterDesign?: string;
  environmentAndBackground?: string;
  fullPrompt: string;
  styleOnlyPrompt: string;
  palette?: { name: string; hex: string }[];
}

type AnalysisEngine = "free-local" | "gemini-ai";

export function ImageDecoder() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [engine, setEngine] = useState<AnalysisEngine>("free-local");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isQuotaError, setIsQuotaError] = useState(false);
  const [result, setResult] = useState<DecodedStyleResult | null>(null);

  const runLocalScanFromUrl = async (imageUrl: string) => {
    const fetchRes = await fetch("/api/fetch-image", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl }),
    });
    const fetchData = (await fetchRes.json()) as {
      previewDataUrl?: string;
      error?: string;
    };
    if (!fetchRes.ok || !fetchData.previewDataUrl) {
      throw new Error(fetchData.error || "Could not load image from that link.");
    }
    setPreviewUrl(fetchData.previewDataUrl);
    const localResult = await analyzeImageLocally(fetchData.previewDataUrl);
    setResult(localResult);
  };

  const runGeminiAnalysis = async (
    payload: { imageBase64: string; mimeType: string } | { imageUrl: string }
  ) => {
    const response = await fetch("/api/analyze-style", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        focusMode: "full",
      }),
    });

    const data = (await response.json()) as DecodedStyleResult & {
      error?: string;
      previewDataUrl?: string;
    };

    if (data.previewDataUrl) {
      setPreviewUrl(data.previewDataUrl);
    }

    if (!response.ok || !data.fullPrompt) {
      if (response.status === 402 || response.status === 429) {
        setIsQuotaError(true);
      }
      throw new Error(data.error || "Could not analyze the provided image.");
    }

    setResult(data);
  };

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file (PNG, JPG, or WEBP).");
      return;
    }

    setError(null);
    setIsQuotaError(false);
    setResult(null);
    setIsAnalyzing(true);

    try {
      const prepared = await prepareImageForUpload(file);
      setPreviewUrl(prepared.previewUrl);

      if (engine === "free-local") {
        const localResult = await analyzeImageLocally(prepared.previewUrl);
        setResult(localResult);
      } else {
        await runGeminiAnalysis({
          imageBase64: prepared.base64,
          mimeType: prepared.mimeType,
        });
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not analyze the selected image."
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyzeUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawInput = imageUrlInput.trim();
    if (!rawInput) {
      setError("Please insert an image link.");
      return;
    }

    const urlMatch = rawInput.match(/https?:\/\/[^\s"'<>]+/i);
    const extracted = urlMatch ? urlMatch[0] : rawInput;

    try {
      const parsed = new URL(extracted);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        setError("Please enter a valid http:// or https:// image link.");
        return;
      }
    } catch {
      setError("Please enter a valid link starting with https:// or http://.");
      return;
    }

    setError(null);
    setIsQuotaError(false);
    setResult(null);
    setIsAnalyzing(true);

    try {
      if (engine === "free-local") {
        await runLocalScanFromUrl(extracted);
      } else {
        await runGeminiAnalysis({ imageUrl: extracted });
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to analyze the image link."
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSwitchToFreeScanOnCurrent = async () => {
    setEngine("free-local");
    setError(null);
    setIsQuotaError(false);
    setIsAnalyzing(true);

    try {
      if (previewUrl) {
        const localResult = await analyzeImageLocally(previewUrl);
        setResult(localResult);
      } else if (imageUrlInput.trim()) {
        const urlMatch = imageUrlInput.trim().match(/https?:\/\/[^\s"'<>]+/i);
        await runLocalScanFromUrl(urlMatch ? urlMatch[0] : imageUrlInput.trim());
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not run local scan on this image."
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleReset = () => {
    setPreviewUrl(null);
    setImageUrlInput("");
    setResult(null);
    setError(null);
    setIsQuotaError(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="w-full max-w-[1040px] mx-auto px-6 py-10 sm:py-14">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl sm:text-4xl font-semibold text-stone-950 tracking-tight text-balance">
            Image to Art Style Prompt
          </h1>
          <p className="mt-2 text-sm sm:text-base text-stone-600">
            Upload an image or insert an image link to analyze its visual style and copy the generated prompt.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto shrink-0">
          <div
            className="flex items-center gap-1 p-1 bg-[#F1ECE2] rounded-lg"
            role="tablist"
            aria-label="Analysis mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={engine === "free-local"}
              onClick={() => {
                setEngine("free-local");
                setError(null);
                setIsQuotaError(false);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                engine === "free-local"
                  ? "bg-white text-stone-950 shadow-sm"
                  : "text-stone-600 hover:text-stone-950"
              }`}
            >
              Free Visual Scan
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={engine === "gemini-ai"}
              onClick={() => {
                setEngine("gemini-ai");
                setError(null);
                setIsQuotaError(false);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                engine === "gemini-ai"
                  ? "bg-white text-stone-950 shadow-sm"
                  : "text-stone-600 hover:text-stone-950"
              }`}
            >
              Gemini AI
            </button>
          </div>

          {(previewUrl || result || error) && (
            <button
              type="button"
              onClick={handleReset}
              disabled={isAnalyzing}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-stone-600 hover:text-stone-950 border border-stone-300 bg-white hover:bg-stone-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
        {/* Left Column: Upload Image Box + Insert Link Box */}
        <div className="lg:col-span-5 space-y-4">
          {/* Upload Image Box */}
          <div className="bg-white border border-stone-200 rounded-lg p-5">
            <p className="text-xs font-medium text-stone-700 mb-3">Upload Image</p>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) {
                  void handleFile(dropped);
                }
              }}
              className={`rounded-md border-2 border-dashed transition-colors p-5 text-center ${
                isDragging
                  ? "border-[#1E3A8A] bg-[#1E3A8A]/5"
                  : "border-stone-300 hover:border-stone-400 bg-[#FBF9F5]"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  e.target.value = "";
                  if (picked) {
                    void handleFile(picked);
                  }
                }}
              />

              {previewUrl ? (
                <div className="space-y-4">
                  <div className="aspect-[4/3] w-full overflow-hidden rounded-md bg-stone-100 border border-stone-200">
                    <img
                      src={previewUrl}
                      alt="Uploaded or linked image preview"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isAnalyzing}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium bg-stone-900 hover:bg-stone-800 text-[#FBF9F5] rounded-md transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Upload Different Image</span>
                  </button>
                </div>
              ) : (
                <div className="py-6 px-2">
                  <div className="w-10 h-10 rounded-full bg-white border border-stone-200 flex items-center justify-center mx-auto mb-3 text-stone-700">
                    <ImagePlus className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <p className="text-sm font-medium text-stone-900">
                    Drop an image here or browse
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    PNG, JPG, or WEBP
                  </p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isAnalyzing}
                    className="mt-4 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium bg-[#1E3A8A] hover:bg-[#172D6B] text-[#FBF9F5] rounded-md transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Choose Image</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Insert Link Box */}
          <div className="bg-white border border-stone-200 rounded-lg p-5">
            <label
              htmlFor="decoder-image-url"
              className="block text-xs font-medium text-stone-700 mb-2.5"
            >
              Insert Image Link
            </label>
            <form onSubmit={handleAnalyzeUrl} className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Link2
                  className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="decoder-image-url"
                  type="text"
                  inputMode="url"
                  value={imageUrlInput}
                  onChange={(e) => setImageUrlInput(e.target.value)}
                  disabled={isAnalyzing}
                  placeholder="Paste image or Pinterest link (https://...)"
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-[#FBF9F5] border border-stone-300 rounded-md text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-[#1E3A8A] focus:ring-1 focus:ring-[#1E3A8A] disabled:opacity-50"
                />
              </div>
              <button
                type="submit"
                disabled={isAnalyzing || !imageUrlInput.trim()}
                className="px-4 py-2.5 text-sm font-medium bg-stone-900 hover:bg-stone-800 text-[#FBF9F5] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAnalyzing ? "Analyzing..." : "Analyze"}
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: Analysis & Prompt Output */}
        <div className="lg:col-span-7">
          {isAnalyzing && (
            <div className="bg-white border border-stone-200 rounded-lg p-12 text-center">
              <Loader2
                className="w-6 h-6 animate-spin text-[#1E3A8A] mx-auto mb-3"
                aria-hidden="true"
              />
              <p className="font-serif text-2xl text-stone-900">
                Analyzing image style
              </p>
              <p className="mt-1.5 text-sm text-stone-500">
                {engine === "free-local"
                  ? "Scanning pigments, lighting contrast, and surface texture..."
                  : "Generating a descriptive prompt from your visual input..."}
              </p>
            </div>
          )}

          {!isAnalyzing && error && (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 rounded-lg p-5 text-red-900 space-y-3"
            >
              <div>
                <p className="text-sm font-semibold">Unable to Analyze Image</p>
                <p className="mt-1 text-sm text-red-800">{error}</p>
              </div>
              {isQuotaError && (previewUrl || imageUrlInput.trim()) && (
                <button
                  type="button"
                  onClick={handleSwitchToFreeScanOnCurrent}
                  className="px-4 py-2 text-xs font-medium bg-[#1E3A8A] hover:bg-[#172D6B] text-[#FBF9F5] rounded-md transition-colors cursor-pointer"
                >
                  Analyze With Free Visual Scan Instead
                </button>
              )}
            </div>
          )}

          {!isAnalyzing && !error && !result && (
            <div className="bg-white border border-stone-200 rounded-lg p-10 text-center sm:text-left">
              <p className="font-serif text-2xl text-stone-900">
                Generated prompt will appear here
              </p>
              <p className="mt-2 text-sm text-stone-600 leading-relaxed">
                Upload an image file or paste an image link on the left.{" "}
                <strong className="font-medium text-stone-900">Free Visual Scan</strong> runs
                on-device without API credits—scanning art style, visual effects, typography bands,
                portrait silhouettes, background/environment zones, and pigments. Switch to{" "}
                <strong className="font-medium text-stone-900">Gemini AI</strong> for deep semantic
                reading of exact fonts, outfits, and scenes.
              </p>
            </div>
          )}

          {!isAnalyzing && result && (
            <div className="bg-white border border-stone-200 rounded-lg p-6 space-y-5">
              <div className="pb-4 border-b border-stone-200">
                <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                  <span>{result.detectedMovement}</span>
                  <span aria-hidden="true">·</span>
                  <span>{result.mediumAndSurface}</span>
                </div>
                <h2 className="mt-1 font-serif text-2xl font-semibold text-stone-950">
                  {result.title}
                </h2>
                {result.palette && result.palette.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-stone-600">
                    {result.palette.map((swatch) => (
                      <div key={`${swatch.name}-${swatch.hex}`} className="flex items-center gap-1.5">
                        <span
                          className="w-3.5 h-3.5 rounded-xs border border-black/15 shrink-0"
                          style={{ backgroundColor: swatch.hex }}
                        />
                        <span className="capitalize">{swatch.name}</span>
                        <span className="font-mono text-[11px] text-stone-400">{swatch.hex}</span>
                      </div>
                    ))}
                  </div>
                )}
                {result.detectedEffects && result.detectedEffects.length > 0 && (
                  <p className="mt-2.5 text-xs text-stone-600">
                    <span className="font-semibold text-stone-800">Effects:</span>{" "}
                    <span>{result.detectedEffects.join(" · ")}</span>
                  </p>
                )}
                {result.typographyAndFonts && (
                  <p className="mt-1.5 text-xs text-stone-600">
                    <span className="font-semibold text-stone-800">Fonts &amp; Typography:</span>{" "}
                    <span>{result.typographyAndFonts}</span>
                  </p>
                )}
                {result.characterDesign && (
                  <p className="mt-1.5 text-xs text-stone-600">
                    <span className="font-semibold text-stone-800">Character Design:</span>{" "}
                    <span>{result.characterDesign}</span>
                  </p>
                )}
                {result.environmentAndBackground && (
                  <p className="mt-1.5 text-xs text-stone-600">
                    <span className="font-semibold text-stone-800">Environment &amp; Background:</span>{" "}
                    <span>{result.environmentAndBackground}</span>
                  </p>
                )}
              </div>

              <div className="p-4 bg-[#FBF9F5] border border-stone-200 rounded-md">
                <div className="flex items-center justify-between gap-4 mb-2.5">
                  <span className="text-xs font-semibold text-stone-900">
                    Descriptive Prompt
                  </span>
                  <CopyButton
                    text={result.fullPrompt}
                    label="Copy Prompt"
                    variant="primary"
                  />
                </div>
                <p className="font-mono text-xs sm:text-sm text-stone-900 leading-relaxed">
                  {result.fullPrompt}
                </p>
              </div>

              <div className="p-4 bg-[#FBF9F5] border border-stone-200 rounded-md">
                <div className="flex items-center justify-between gap-4 mb-2.5">
                  <span className="text-xs font-semibold text-stone-900">
                    Style-Only Prompt (Without Subject)
                  </span>
                  <CopyButton
                    text={result.styleOnlyPrompt}
                    label="Copy Style Prompt"
                    variant="secondary"
                  />
                </div>
                <p className="font-mono text-xs sm:text-sm text-stone-800 leading-relaxed">
                  {result.styleOnlyPrompt}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
