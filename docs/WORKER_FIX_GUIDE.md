# Debugging Guide: Fix `quest-image-manager` for JSON Proxying

## Context
The frontend (`quest-app-template`) needs to load puzzle data (`data.json`) from a private S3 bucket. Direct access is forbidden. The existing worker `quest-image-manager` is supposed to proxy these requests but is failing.

## The Problem
**Worker URL**: `https://quest-image-manager-dev.denslov.workers.dev/image/clients/.../data.json`
**Status**: Returns `404 Not Found` with body `{"error":"Image not found"}`.

**Alternative (Incorrect) URL**: `.../clients/...` (no /image/ prefix)
**Status**: Returns `400 Bad Request` with body `{"error":"Missing client_id parameter"}`.

**Likely Causes**:
1.  **File Type Restriction**: The "Image not found" error strongly suggests the worker is logic-gated to look for images or validate extensions, rejecting `.json`.
2.  **Path Mapping**: The worker might be routing `.../image/...` incorrectly to the underlying storage (S3/R2).
3.  **Wrong Bucket**: The worker might be bound to an image-only bucket instead of `quest-platform-users` where the JSON lives.

## The Solution (Steps to Execute in `quest-platform`)

### 1. Verify R2 Binding
Check `wrangler.toml` (or dashboard) for `quest-image-manager`.
- Ensure it has a binding to the `quest-platform-users` R2 bucket.
- Using the wrong bucket (e.g., `quest-images`) would return 404 even if the path is correct.

### 2. Locate the Worker
Find the `quest-image-manager` code in `backend/workers/` (or similar path in `quest-platform`).

### 2. Check Extension/MIME Validation
Look for code that validates file types.
```typescript
// Look for something like:
const ALLOWED_EXTENSIONS = ['jpg', 'png', 'webp'];
// Add 'json' to this list
```

### 3. Check Route Handling
Verify how the URL matches the storage key.
- Request: `/image/clients/USER_ID/...`
- Expected Storage Key: `clients/USER_ID/...` (ensure the `/image` prefix is stripped correctly).

### 4. Deploy & Verify
- Deploy the updated worker.
- Test the URL in the browser: `https://quest-image-manager-dev.denslov.workers.dev/image/clients/915b3510-c0a1-7075-ba32-d63633b69867/platform-library/puz-b859cdc3/data.json`
- It should return the JSON content.
