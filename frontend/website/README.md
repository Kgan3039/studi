# Studi Launch Site

Minimal Next.js website for Studi public landing, privacy, and support pages.

## Local development

```bash
cd frontend/website
npm install
npm run dev
```

Open http://localhost:3000.

## Production build

```bash
npm run build
npm start
```

## Deploy to Vercel

Create a Vercel project from this repository and set:

- Framework Preset: Next.js
- Root Directory: `frontend/website`
- Build Command: `npm run build`
- Install Command: `npm install`
- Output Directory: leave blank

No environment variables are required.
