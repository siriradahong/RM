# เชื่อมโยง — Khon Kaen Connect

High-fidelity interactive web prototype for the Bureau of Public Health and Environment, Khon Kaen Municipality. Thai UI, responsive layout, 12 connected screen types, and September 2569 demonstration data.

Open `index.html` directly in a browser, or run `python3 -m http.server 8000` in this folder and visit `http://localhost:8000`.

The initial view is the bureau dashboard. Click the account at the top right to select one or several demonstration roles. Sign out to see the login screen; demo credentials are `demo` / `demo123`.

Includes dashboards, searchable library, import wizard, evidence review, internal news feed, news drafting and publication, account management, master data, simulated LINE settings, and read-only audit history. Edits are stored in browser localStorage. Real authentication, file storage, AI extraction, and LINE delivery are not connected. Selected local files are validated and represented by metadata; extraction uses placeholder fields requiring manual review. Photos are illustrative stock images. Google Fonts and images require an internet connection.

The six initial library records illustrate selected activities within aggregate monthly totals; the library explicitly labels these as sample records rather than claiming to contain all 240 activities. No KPI targets, plans, GPS, Facebook, or generated Word/PDF reports are included.
