#!/usr/bin/env bash
set -euo pipefail

# sync-oss.sh — Copy OSS-designated files from private repo to public repo
# Usage: ./scripts/sync-oss.sh [tag]
# Example: ./scripts/sync-oss.sh v0.1.0

TAG="${1:-}"
PRIVATE_REPO="Axis-Labs-HQ/vaultproxy-cloud"
PUBLIC_REPO="Axis-Labs-HQ/vaultproxy"
WORK_DIR=$(mktemp -d)

cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

echo "==> Cloning private repo..."
git clone --depth 1 "https://github.com/${PRIVATE_REPO}.git" "$WORK_DIR/private" 2>/dev/null

echo "==> Cloning public repo..."
git clone "https://github.com/${PUBLIC_REPO}.git" "$WORK_DIR/public" 2>/dev/null

# Clear public repo (except .git)
find "$WORK_DIR/public" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +

echo "==> Copying OSS files..."

# --- Root files ---
cp "$WORK_DIR/private/README.md" "$WORK_DIR/public/"
cp "$WORK_DIR/private/LICENSE" "$WORK_DIR/public/"
cp "$WORK_DIR/private/.gitignore" "$WORK_DIR/public/"

# --- Edge proxy (full) ---
cp -r "$WORK_DIR/private/edge-proxy" "$WORK_DIR/public/"

# --- Control plane (selective) ---
mkdir -p "$WORK_DIR/public/control-plane/cmd/server"
mkdir -p "$WORK_DIR/public/control-plane/internal/api"
mkdir -p "$WORK_DIR/public/control-plane/internal/config"
mkdir -p "$WORK_DIR/public/control-plane/internal/db"
mkdir -p "$WORK_DIR/public/control-plane/internal/keys"

# Core Go files
cp "$WORK_DIR/private/control-plane/go.mod" "$WORK_DIR/public/control-plane/"
[ -f "$WORK_DIR/private/control-plane/go.sum" ] && cp "$WORK_DIR/private/control-plane/go.sum" "$WORK_DIR/public/control-plane/"
cp "$WORK_DIR/private/control-plane/.env.example" "$WORK_DIR/public/control-plane/"
cp "$WORK_DIR/private/control-plane/cmd/server/main.go" "$WORK_DIR/public/control-plane/cmd/server/"
cp "$WORK_DIR/private/control-plane/internal/config/config.go" "$WORK_DIR/public/control-plane/internal/config/"
cp "$WORK_DIR/private/control-plane/internal/db/db.go" "$WORK_DIR/public/control-plane/internal/db/"
cp "$WORK_DIR/private/control-plane/internal/keys/keys.go" "$WORK_DIR/public/control-plane/internal/keys/"

# API files (no push, audit, or member handlers)
cp "$WORK_DIR/private/control-plane/internal/api/handlers_internal.go" "$WORK_DIR/public/control-plane/internal/api/"
cp "$WORK_DIR/private/control-plane/internal/api/middleware.go" "$WORK_DIR/public/control-plane/internal/api/"
cp "$WORK_DIR/private/control-plane/internal/api/router.go" "$WORK_DIR/public/control-plane/internal/api/"
cp "$WORK_DIR/private/control-plane/internal/api/validate.go" "$WORK_DIR/public/control-plane/internal/api/"
cp "$WORK_DIR/private/control-plane/internal/api/handlers.go" "$WORK_DIR/public/control-plane/internal/api/"

# --- Docs (no .context/specs) ---
[ -d "$WORK_DIR/private/docs" ] && cp -r "$WORK_DIR/private/docs" "$WORK_DIR/public/"

# --- CI ---
[ -d "$WORK_DIR/private/.github" ] && cp -r "$WORK_DIR/private/.github" "$WORK_DIR/public/"

# --- Excluded (verify) ---
echo "==> Verifying exclusions..."
VIOLATIONS=0

check_excluded() {
    if [ -e "$WORK_DIR/public/$1" ]; then
        echo "  ERROR: $1 should not be in the public repo!"
        VIOLATIONS=$((VIOLATIONS + 1))
    fi
}

check_excluded "dashboard"
check_excluded "control-plane/internal/push"
check_excluded "control-plane/internal/cron"
check_excluded ".context"
check_excluded "OPEN_SOURCE_BOUNDARY.md"

if [ $VIOLATIONS -gt 0 ]; then
    echo "==> FAILED: $VIOLATIONS proprietary files found in public repo. Aborting."
    exit 1
fi

echo "==> No proprietary files found. Clean."

# --- Commit and push ---
cd "$WORK_DIR/public"
git add -A

if git diff --cached --quiet; then
    echo "==> No changes to sync."
    exit 0
fi

COMMIT_MSG="Sync from private repo"
if [ -n "$TAG" ]; then
    COMMIT_MSG="Release $TAG — sync from private repo"
fi

git commit -m "$COMMIT_MSG"

if [ -n "$TAG" ]; then
    git tag "$TAG"
fi

echo "==> Pushing to $PUBLIC_REPO..."
git push origin main
[ -n "$TAG" ] && git push origin "$TAG"

echo "==> Done. Public repo synced."
[ -n "$TAG" ] && echo "    Tagged: $TAG"
