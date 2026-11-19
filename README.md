# SUPER PROMPT — Image to Art Style Prompt

A minimal one-page web application that analyzes uploaded images or pasted image/Pinterest links to generate detailed, copy-ready art-style prompts (including pigments, visual/3D effects, typography/fonts, character design, and environment/background).

## Features

- **Upload Image & Insert Link** (supports direct image URLs and Pinterest pin links via `/api/fetch-image`).
- **Gemini AI Mode**: Uses your server-side `GEMINI_API_KEY` (with free-tier-capable `gemini-4-hydrogen` / `gemini-3.1-flash-lite` models via `@google/genai`) to generate deep semantic prompts, typography descriptions, character design breakdowns, effects, and environment descriptions.
- **Free Visual Scan Mode**: Runs completely on-device in the browser without requiring any API credits.

---

## Hosting From GitHub (`github.com`)

> **Important note about GitHub Pages:** GitHub Pages only serves static HTML/JS files—it cannot run the Node.js Express server (`server.ts`) needed to protect your `GEMINI_API_KEY` on the server or fetch external/Pinterest image links without browser CORS errors.
>
> To host the full application with your **free-tier Gemini API key**, push this repository to GitHub and deploy it on any Node.js host (**Render**, **Railway**, **Fly.io**, or **Google Cloud Run**).

### 1. Push the Code to GitHub

`.gitignore` is already configured to exclude `node_modules/`, `dist/`, and `.env*` (while keeping `.env.example`), so your secret keys are never committed.

```bash
git init
git add .
git commit -m "Initial commit: SUPER PROMPT"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

### 2. Get a Free-Tier Gemini API Key

1. Open **[Google AI Studio API Keys](https://aistudio.google.com/apikey)**.
2. Create an API key under a **free-tier project** (a project without depleted prepayment billing attached).

### 3. Deploy From GitHub (e.g., Render Free Tier)

This repository includes `render.yaml` for automatic setup:

1. Create a new **Blueprint** or **Web Service** on [Render](https://render.com) connected to your GitHub repository.
2. Confirm the build & start commands:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Node Version:** `>= 22.18.0` (declared in `package.json`)
3. Add your environment variables in the host dashboard:
   - `NODE_ENV` = `production`
   - `GEMINI_API_KEY` = `<your-free-tier-gemini-api-key>`

---

## Run Locally

```bash
npm install
cp .env.example .env
# Edit .env and paste your free-tier GEMINI_API_KEY
```

Development mode:

```bash
npm run dev
```

Production build & start:

```bash
npm run build
npm start
```

Open `http://localhost:3000`.
