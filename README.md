# File Manager — GitHub style

This is a small static web UI to browse files in a GitHub repository using the GitHub REST API. Paste a repo URL (https://github.com/owner/repo) and click Load.

Features
- Browse directories and files
- View raw file contents
- Optional Personal Access Token input to access private repositories or increase rate limits

Notes
- This is a static client-side app that calls the GitHub API directly from the browser. For private repos you must provide a token with appropriate scopes (repo).
- When using client-side tokens, treat them carefully — do not paste long-lived tokens on shared machines. For production usage, proxy the API through a backend that keeps secrets safe.

How to run
1. Serve the repository files (e.g., `python -m http.server` in the repo root) and open http://localhost:8000
2. Paste a GitHub repo URL and press Load.

Possible improvements
- File syntax highlighting
- Pagination for large directories
- Commit & branch selector
- Caching and error retries

