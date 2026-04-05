This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Phase 0 — GitHub and Vercel

This repo is meant to live in its **own** GitHub repository (not the parent `Code/` folder).

1. **GitHub:** install [GitHub CLI](https://cli.github.com/) (`brew install gh`), then from this directory:

   ```bash
   gh auth login
   gh repo create <your-repo-name> --source=. --public --remote=origin --push
   ```

   Use any unused repo name, or create an empty repo on GitHub and run `git remote add origin …` then `git push -u origin main`.

2. **Vercel:** in the [Vercel dashboard](https://vercel.com/new), **Import** the GitHub repo. Framework: Next.js (auto-detected). Deploy and open the production URL.

## Deploy on Vercel

After the repo is on GitHub, the [Vercel import flow](https://vercel.com/new) is the standard way to get a live URL. See [Next.js deployment](https://nextjs.org/docs/app/building-your-application/deploying) for details.
