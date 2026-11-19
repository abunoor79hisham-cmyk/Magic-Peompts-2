import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey === "YOUR_FREE_TIER_GEMINI_API_KEY") {
    throw new Error(
      "GEMINI_API_KEY is not configured. Add your free-tier key to .env (locally), your host's Environment Variables, or Settings > Secrets."
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

interface AnalyzeStyleBody {
  imageBase64?: string;
  imageUrl?: string;
  mimeType?: string;
  focusMode?: "full" | "style_only" | "keywords";
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]" ||
    host === "0.0.0.0" ||
    host.endsWith(".local")
  ) {
    return true;
  }
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31)
    ) {
      return true;
    }
  }
  return false;
}

function detectImageMimeFromBytes(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buf.subarray(0, 3).toString("ascii") === "GIF") {
    return "image/gif";
  }
  return null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractMetaContent(html: string, attrName: string, attrValue: string): string | null {
  const tagRegex = /<meta\s+[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(html)) !== null) {
    const tag = match[0];
    const attrPattern = new RegExp(
      `${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "i"
    );
    const attrMatch = tag.match(attrPattern);
    const foundVal = attrMatch?.[1] ?? attrMatch?.[2] ?? attrMatch?.[3] ?? "";
    if (foundVal.toLowerCase() !== attrValue.toLowerCase()) {
      continue;
    }
    const contentMatch = tag.match(
      /content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
    );
    const content = contentMatch?.[1] ?? contentMatch?.[2] ?? contentMatch?.[3];
    if (content) {
      return decodeHtmlEntities(content.trim());
    }
  }
  return null;
}

function extractImageUrlFromHtml(html: string, baseUrl: string): string | null {
  const candidates: string[] = [];

  // 1. Pinterest Pin structured JSON fields (highest accuracy for pin.it / pinterest.com/pin/ links)
  const pinJsonPatterns = [
    /"images_orig"\s*:\s*\{[^}]*"url"\s*:\s*"(https:[^"]+)"/i,
    /"imageLargeUrl"\s*:\s*"(https:[^"]+)"/i,
    /"images_736x"\s*:\s*\{[^}]*"url"\s*:\s*"(https:[^"]+)"/i,
    /"images_564x"\s*:\s*\{[^}]*"url"\s*:\s*"(https:[^"]+)"/i,
  ];
  for (const pattern of pinJsonPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      candidates.push(match[1].replace(/\\u002F/g, "/").replace(/\\\//g, "/"));
    }
  }

  // 2. Standard OpenGraph and Twitter card image tags
  const ogSecure = extractMetaContent(html, "property", "og:image:secure_url");
  const ogImage = extractMetaContent(html, "property", "og:image");
  const twImage = extractMetaContent(html, "name", "twitter:image");
  const twImageSrc = extractMetaContent(html, "name", "twitter:image:src");
  const twImageProp = extractMetaContent(html, "property", "twitter:image");

  for (const c of [ogSecure, ogImage, twImage, twImageSrc, twImageProp]) {
    if (c) candidates.push(c);
  }

  // 3. <link rel="image_src" href="...">
  const linkMatch = html.match(
    /<link\s+[^>]*rel\s*=\s*["']image_src["'][^>]*href\s*=\s*["']([^"']+)["']/i
  );
  if (linkMatch?.[1]) {
    candidates.push(decodeHtmlEntities(linkMatch[1].trim()));
  }

  // 4. Fallback to first non-tracking <img> src outside <style> blocks
  const htmlWithoutStyles = html.replace(/<style[\s\S]*?<\/style>/gi, "");
  const imgRegex = /<img\s+[^>]*src\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/gi;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgRegex.exec(htmlWithoutStyles)) !== null) {
    const src = decodeHtmlEntities((imgMatch[1] || imgMatch[2] || "").trim());
    if (
      src &&
      !src.startsWith("data:") &&
      !/logo|avatar|icon|sprite|1x1|pixel|75x75_RS/i.test(src)
    ) {
      candidates.push(src);
      break;
    }
  }

  // 5. Fallback Pinterest CDN URLs outside <style> blocks
  const pinMatches = htmlWithoutStyles.match(
    /https:\/\/i\.pinimg\.com\/(?:originals|1200x|736x|564x)\/[a-zA-Z0-9/_-]+\.(?:jpg|jpeg|png|webp)/gi
  );
  if (pinMatches && pinMatches.length > 0) {
    const filtered = pinMatches.filter(
      (u) => !u.includes("d53b014d86a6b6761bf649a0ed813c2b")
    );
    if (filtered.length > 0) {
      const sorted = [...filtered].sort((a, b) => {
        const rank = (u: string) =>
          u.includes("/originals/")
            ? 0
            : u.includes("/1200x/")
              ? 1
              : u.includes("/736x/")
                ? 2
                : 3;
        return rank(a) - rank(b);
      });
      candidates.push(sorted[0]);
    }
  }

  for (const candidate of candidates) {
    try {
      const resolved = new URL(candidate, baseUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        return resolved.toString();
      }
    } catch {
      // Ignore malformed candidate URL
    }
  }

  return null;
}

async function fetchExternalImageAsBase64(
  rawUrl: string,
  depth = 0
): Promise<{ base64: string; mimeType: string }> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("Invalid image URL. Please enter a complete http:// or https:// link.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Only http:// and https:// image links are supported.");
  }

  if (isPrivateOrLocalHostname(parsedUrl.hostname)) {
    throw new Error("Local or private network URLs cannot be fetched.");
  }

  const response = await fetch(parsedUrl.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept:
        depth === 0
          ? "image/webp,image/png,image/jpeg,image/gif,text/html;q=0.9,*/*;q=0.8"
          : "image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    throw new Error(
      `Could not download image from URL (server responded ${response.status}).`
    );
  }

  const contentLength = Number(response.headers.get("content-length") || "0");
  const MAX_BYTES = 12 * 1024 * 1024;
  if (contentLength > MAX_BYTES) {
    throw new Error("Linked image is larger than the 12 MB limit.");
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length === 0) {
    throw new Error("The linked URL returned an empty response.");
  }
  if (buffer.length > MAX_BYTES) {
    throw new Error("Linked image is larger than the 12 MB limit.");
  }

  const headerType = (response.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  const byteMime = detectImageMimeFromBytes(buffer);
  const resolvedMime =
    byteMime ||
    (/^image\/(jpeg|jpg|png|webp|gif)$/i.test(headerType)
      ? headerType === "image/jpg"
        ? "image/jpeg"
        : headerType
      : "");

  if (resolvedMime) {
    return {
      base64: buffer.toString("base64"),
      mimeType: resolvedMime,
    };
  }

  // If the link resolved to a webpage (e.g., Pinterest pin link, pin.it, etc.), extract the image URL from the HTML
  const looksLikeHtml =
    headerType.includes("text/html") ||
    headerType.includes("application/xhtml+xml") ||
    buffer.subarray(0, 64).toString("utf8").trimStart().startsWith("<");

  if (depth === 0 && looksLikeHtml) {
    const html = buffer.toString("utf8");
    const extractedUrl = extractImageUrlFromHtml(
      html,
      response.url || parsedUrl.toString()
    );
    if (extractedUrl) {
      return fetchExternalImageAsBase64(extractedUrl, 1);
    }
    throw new Error(
      "Could not find a direct image on that page. Try long-pressing the image and choosing 'Copy image address' or downloading and uploading it."
    );
  }

  throw new Error(
    "The link does not point to a supported image file (PNG, JPG, WEBP, or GIF)."
  );
}

interface EnhancePromptBody {
  subject?: string;
  movement?: string;
  era?: string;
  techniques?: string[];
  lighting?: string;
  palette?: string;
  format?: "narrative" | "tags" | "technical";
}

function isRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED");
}

async function generateWithFallback(
  ai: GoogleGenAI,
  contents: unknown,
  config: Record<string, unknown>
) {
  try {
    return await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: contents as never,
      config: {
        ...config,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW,
        },
      },
    });
  } catch (primaryErr) {
    if (!isRateLimitError(primaryErr)) {
      throw primaryErr;
    }
    console.warn("gemini-4-hydrogen rate-limited, retrying with gemini-3.1-flash-lite:", primaryErr instanceof Error ? primaryErr.message : primaryErr);
    await new Promise((resolve) => setTimeout(resolve, 600));
    return await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: contents as never,
      config: {
        ...config,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.MINIMAL,
        },
      },
    });
  }
}

function mapGeminiError(error: unknown): { status: number; message: string } {
  const rawMessage =
    error instanceof Error ? error.message : "Unexpected error communicating with Gemini.";

  console.error("Gemini API error:", rawMessage);

  if (rawMessage.includes("GEMINI_API_KEY is not configured")) {
    return { status: 503, message: rawMessage };
  }
  if (rawMessage.includes("403") || rawMessage.includes("PERMISSION_DENIED")) {
    return {
      status: 403,
      message:
        "Gemini API permission denied. Check your GEMINI_API_KEY in .env, your hosting Environment Variables, or Settings > Secrets.",
    };
  }
  if (rawMessage.includes("400") || rawMessage.includes("API_KEY_INVALID")) {
    return {
      status: 400,
      message:
        "The image or API key could not be validated. Please verify your image format or GEMINI_API_KEY configuration.",
    };
  }
  if (rawMessage.includes("402") || rawMessage.includes("prepayment credits")) {
    return {
      status: 402,
      message:
        "Gemini API prepayment credits are depleted on this project key. Use Free Visual Scan below, or switch to a free-tier project key from https://aistudio.google.com/apikey.",
    };
  }
  if (rawMessage.includes("429") || rawMessage.includes("RESOURCE_EXHAUSTED")) {
    return {
      status: 429,
      message:
        "Gemini API quota limit reached for your current API key. Use Free Visual Scan below or wait a moment before retrying.",
    };
  }
  return { status: 500, message: rawMessage };
}

async function startServer() {
  const app = express();

  app.use(express.json({ limit: "15mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", hasGeminiKey: Boolean(process.env.GEMINI_API_KEY) });
  });

  app.post("/api/interactions/test", async (req, res) => {
    try {
      const body = req.body as { input?: string; model?: string };
      const promptInput =
        body?.input?.trim() || "Explain how AI works in a few words.";
      const allowedModels = new Set([
        "gemini-4-hydrogen",
        "gemini-3.1-flash-lite",
      ]);
      const model =
        body?.model && allowedModels.has(body.model.trim())
          ? body.model.trim()
          : "gemini-3.1-flash-lite";
      const ai = getGeminiClient();
      const interaction = await ai.interactions.create({
        model,
        input: promptInput,
      });
      res.json({
        id: interaction.id,
        model,
        reply: interaction.output_text ?? "",
      });
    } catch (error) {
      const { status, message } = mapGeminiError(error);
      res.status(status).json({ error: message });
    }
  });

  app.post("/api/fetch-image", async (req, res) => {
    try {
      const imageUrl = (req.body as { imageUrl?: string })?.imageUrl?.trim();
      if (!imageUrl) {
        res.status(400).json({ error: "Please insert an image link." });
        return;
      }
      const fetched = await fetchExternalImageAsBase64(imageUrl);
      res.json({
        previewDataUrl: `data:${fetched.mimeType};base64,${fetched.base64}`,
      });
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Could not load image from that URL.",
      });
    }
  });

  app.post("/api/analyze-style", async (req, res) => {
    try {
      const body = req.body as AnalyzeStyleBody;
      const imageUrl = body.imageUrl?.trim();
      let imageBase64 = body.imageBase64?.trim();
      let mimeType = body.mimeType?.trim() || "image/jpeg";
      const focusMode = body.focusMode || "full";

      let previewDataUrl: string | undefined;

      if (imageUrl) {
        try {
          const fetched = await fetchExternalImageAsBase64(imageUrl);
          imageBase64 = fetched.base64;
          mimeType = fetched.mimeType;
          previewDataUrl = `data:${mimeType};base64,${imageBase64}`;
        } catch (fetchErr) {
          res.status(400).json({
            error:
              fetchErr instanceof Error
                ? fetchErr.message
                : "Could not load image from that URL.",
          });
          return;
        }
      }

      if (!imageBase64) {
        res.status(400).json({ error: "Please upload an image or paste an image URL." });
        return;
      }

      if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(mimeType)) {
        res.status(400).json({
          error: "Unsupported image format. Please use a PNG, JPG, or WEBP image.",
        });
        return;
      }

      const ai = getGeminiClient();

      const focusGuidance =
        focusMode === "style_only"
          ? "Prioritize extracting subject-independent artistic traits: medium, brushwork, substrate texture, pigment harmony, lighting geometry, and historical lineage."
          : focusMode === "keywords"
            ? "Prioritize crisp, high-signal visual tokens suitable for diffusion prompt engineering alongside complete technical observations."
            : "Provide a comprehensive art-historical and technical visual breakdown covering both the depicted scene and the exact stylistic execution.";

      const response = await generateWithFallback(
        ai,
        {
          parts: [
            {
              inlineData: {
                mimeType,
                data: imageBase64,
              },
            },
            {
              text: `Analyze this artwork or visual reference as an expert art historian, character designer, and typographer. ${focusGuidance}

Examine:
1. Artistic movement, medium, surface texture, brushwork or line quality, lighting, and pigment palette.
2. ALL visual, dimensional, print, or digital effects and rendering styles (photorealistic/realistic detail, Pixar-style 3D animation, clay/claymation sculpting, 3D CGI render/raytracing, geometric faceted shapes, architectural perspective/structural style, glitch, RGB chromatic split, CRT scanlines, pop art, paper cutout, layered collage, halftone/Ben-Day dots, stippling, pointillism, pixelation/mosaic, film grain, ink splatter, vignette, halation/bloom, or double exposure).
3. Typography & Fonts (if any text, lettering, titles, captions, or signage appear): identify the font/lettering style (e.g., bold condensed sans-serif, editorial serif, brush script, gothic blackletter, distressed grunge, pixel bitmap, retro display, outlined comic lettering), weight, treatment, and integration. Return "" if no text appears.
4. Character Design & Figures (if any people or stylized characters appear): analyze body proportions (realistic, Pixar-style 3D proportions, clay figurine, elongated, stylized cartoon, chibi, anime), facial stylization and expression, hair silhouette, costume/outfit shapes and fabric rendering, pose/attitude, and contour/shading treatment. Return "" if no people or characters appear.
5. Environment & Background: describe the physical setting, architectural structure, backdrop, scenery, landscape, sky, lighting atmosphere, studio sweep, or depth-of-field blur surrounding the main subject.

Then craft:
- detectedEffects: Short array of specific visual, dimensional, print, or digital effects and rendering styles observed (e.g., realistic photography, Pixar-style 3D animation, clay/claymation texture, 3D CGI render, geometric forms, architectural lines, halftone Ben-Day dots, RGB glitch split, paper cutout collage, pop art, stippling, scanlines, grain — empty array if none).
- typographyAndFonts: Concise description of visible fonts/lettering style, or "" if none present.
- characterDesign: Concise description of character proportions, silhouette, outfit, hair, facial styling, and rendering, or "" if no figures appear.
- environmentAndBackground: Concise description of the setting, scenery, backdrop, and spatial depth/atmosphere.
- fullPrompt: A vivid 70–105 word descriptive prompt describing the scene, environment/background, subject/character design, visible typography/font styling, detected effects/rendering style, and all stylistic, medium, lighting, and surface details.
- styleOnlyPrompt: A reusable 45–75 word style-transfer prompt capturing the artistic technique, medium, palette, lighting, texture, visual effects/dimensional rendering style, background atmosphere handling, and rendering rules for typography/character styling (without locking to a specific named character or exact literal text string).`,
            },
          ],
        },
        {
          systemInstruction:
            "You are a museum curator, 3D visual-effects director, character design director, and typographer specializing in translating visual artworks into precise image-generation prompts. Always include rendering and graphic/digital effects (realistic, Pixar 3D, clay/claymation, 3D CGI art, geometric, architectural style, glitch, pop art, collage, cutout, dots), visible font/typography treatments, people/character design styling, and environment/background atmosphere whenever present. Return valid JSON matching the requested schema.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: {
                type: Type.STRING,
                description: "Short museum-style descriptive title for the detected aesthetic.",
              },
              detectedMovement: {
                type: Type.STRING,
                description: "Primary artistic movement or stylistic school observed.",
              },
              mediumAndSurface: {
                type: Type.STRING,
                description: "Medium, pigment or 3D shader/material type, and physical substrate or clay/CGI surface.",
              },
              detectedEffects: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Specific rendering or post-processing effects used (e.g., photorealistic detail, Pixar-style 3D animation, sculpted clay/claymation, 3D CGI render, geometric shapes, architectural perspective, halftone Ben-Day dots, RGB glitch split, paper cutout collage, pop art color blocking, stippling, scanlines, grain).",
              },
              typographyAndFonts: {
                type: Type.STRING,
                description: "Font and lettering style observed if text is present, or empty string if no text appears.",
              },
              characterDesign: {
                type: Type.STRING,
                description: "Character design breakdown (proportions, silhouette, facial features, hair, clothing, line/shading style) if people/characters appear, or empty string if none appear.",
              },
              environmentAndBackground: {
                type: Type.STRING,
                description: "Setting, scenery, backdrop, props, spatial depth, and background atmosphere.",
              },
              fullPrompt: {
                type: Type.STRING,
                description: "Complete descriptive prompt combining subject, environment/background, visual style, effects, font styling, and character design.",
              },
              styleOnlyPrompt: {
                type: Type.STRING,
                description: "Subject-agnostic style prompt including technique, medium, lighting, effects, background treatment, and rendering rules for fonts/characters.",
              },
            },
            required: [
              "title",
              "detectedMovement",
              "mediumAndSurface",
              "detectedEffects",
              "typographyAndFonts",
              "characterDesign",
              "environmentAndBackground",
              "fullPrompt",
              "styleOnlyPrompt",
            ],
          },
        }
      );

      const rawText = (response.text ?? "{}").trim();
      const parsed = JSON.parse(rawText);
      res.json(previewDataUrl ? { ...parsed, previewDataUrl } : parsed);
    } catch (error) {
      const { status, message } = mapGeminiError(error);
      res.status(status).json({ error: message });
    }
  });

  app.post("/api/prompts/enhance", async (req, res) => {
    try {
      const body = req.body as EnhancePromptBody;
      const subject = body.subject?.trim();
      const movement = body.movement?.trim();

      if (!subject || !movement) {
        res.status(400).json({ error: "Subject and artistic movement are required." });
        return;
      }

      const techniques = Array.isArray(body.techniques) ? body.techniques : [];
      const lighting = body.lighting?.trim() || "natural directional light";
      const palette = body.palette?.trim() || "balanced mineral pigments";
      const format = body.format || "narrative";

      const formatInstruction =
        format === "tags"
          ? "Output ONLY a clean comma-separated sequence of 16–22 evocative, non-redundant prompt tags starting with the subject, followed by movement, medium, brushwork, lighting, palette, and surface texture. No introductory text or quotes."
          : format === "technical"
            ? "Output ONLY a crisp art-director specification formatted in 4 concise labeled clauses separated by semicolons or line breaks: Subject & Framing; Movement & Medium; Technique & Surface; Illumination & Palette. No markdown bullets."
            : "Output ONLY a single cohesive, vividly written 60–85 word image-generation prompt in natural prose that seamlessly integrates the subject, movement, physical techniques, lighting, and pigment palette. No preamble, no quotation marks.";

      const ai = getGeminiClient();

      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: `Compose an authentic art-generation prompt using these specifications:
- Subject: ${subject}
- Artistic Movement: ${movement}${body.era ? ` (${body.era})` : ""}
- Techniques & Mediums: ${techniques.length > 0 ? techniques.join(", ") : "traditional archival craft"}
- Lighting & Atmosphere: ${lighting}
- Pigment Palette & Substrate: ${palette}

${formatInstruction}`,
        config: {
          systemInstruction:
            "You are a master art historian and visual prompt writer. Write grounded, tactile descriptions referencing authentic materials, brushwork, and light behavior. Never include buzzwords like '8k', 'masterpiece', 'trending on artstation', or 'hyperrealistic' unless specifically fitting.",
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
        },
      });

      const promptText = (response.text ?? "").trim();
      if (!promptText) {
        res.status(502).json({ error: "No prompt text was returned by the model." });
        return;
      }

      res.json({ prompt: promptText });
    } catch (error) {
      const { status, message } = mapGeminiError(error);
      res.status(status).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await import("vite");
    const viteServer = await vite.createServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
      },
      appType: "spa",
    });
    app.use(viteServer.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Atelier Lexicon server running at http://localhost:${PORT}`);
  });
}

startServer();
