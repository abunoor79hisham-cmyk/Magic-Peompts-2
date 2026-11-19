export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to textarea selection in restricted iframes.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export async function prepareImageForUpload(file: File): Promise<{
  base64: string;
  mimeType: string;
  previewUrl: string;
}> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the selected image file."));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Selected file is not a valid image."));
    image.src = dataUrl;
  });

  const maxEdge = 1280;
  let { width, height } = img;
  if (width > maxEdge || height > maxEdge) {
    const scale = maxEdge / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to initialize canvas for image processing.");
  }
  ctx.drawImage(img, 0, 0, width, height);

  const outputMime = file.type === "image/png" ? "image/png" : "image/jpeg";
  const compressedDataUrl = canvas.toDataURL(
    outputMime,
    outputMime === "image/jpeg" ? 0.88 : undefined
  );
  const base64 = compressedDataUrl.split(",")[1] || "";

  return {
    base64,
    mimeType: outputMime,
    previewUrl: compressedDataUrl,
  };
}
