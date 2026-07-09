# HEYTEA Points Tracker

A simple browser-based tracker for HEYTEA points expiration. Add earned points, record points you use, import a screen recording for OCR, and see which balances expire next.

The app is built as a static site for GitHub Pages. There is no build step and no backend.

Video import runs in the browser. The page samples frames from the uploaded recording, sends those frames through Tesseract.js OCR, parses likely date/points rows, and lets you add detected entries to the tracker.

## Use locally

Open `index.html` in a browser.

## Publish with GitHub Pages

1. Push this repository to GitHub.
2. Open the repository settings.
3. Go to **Pages**.
4. Set **Source** to **Deploy from a branch**.
5. Choose your default branch and `/ (root)`.
6. Save.

GitHub will publish the site at:

```text
https://<your-username>.github.io/heytea-points-tracker/
```

## How expiration is calculated

Earned points last 6 months and expire at 00:00 on the 1st day of the following month.

Example: points earned on February 5 expire on September 1.
