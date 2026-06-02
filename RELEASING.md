# Releasing Claude Coach

This document describes how to release a new version of Claude Coach.

## Automated skill releases (GitHub Actions)

The skill zip is published automatically by [`.github/workflows/release-skill.yml`](.github/workflows/release-skill.yml) — you normally don't need to attach it by hand:

- **Every push to `main`** rebuilds `coach-skill.zip` and refreshes a rolling **`skill-latest`** release (marked as the latest release). That keeps the install link working:
  `https://github.com/marijnvandevoorde/claude-coach/releases/latest/download/coach-skill.zip`
- **Pushing a `v*` tag** (e.g. `v0.2.0`) cuts a matching **versioned** release with the same asset.
- The workflow can also be run manually from the Actions tab (`workflow_dispatch`).

So for a skill-only change, merging to `main` is enough. The steps below are for a full, versioned npm + GitHub release.

## Prerequisites

- npm account with publish access to `claude-coach`
- GitHub account with push access to the repository
- GitHub CLI (`gh`) installed and authenticated

## Release Steps

### 1. Update Version

Update the version number in `package.json`:

```bash
npm version patch  # or minor, or major
```

This will:

- Bump the version in package.json
- Create a git commit
- Create a git tag

The About tab automatically reads the version from package.json at build time.

### 2. Build Everything

```bash
# Build the viewer (creates templates/plan-viewer.html)
npm run build:viewer

# Build the skill zip (creates dist/coach-skill.zip)
npm run build:skill
```

### 3. Publish to npm

```bash
npm publish
```

This publishes the package to npm, making it available via `npx claude-coach`.

### 4. Push to GitHub

```bash
git push origin main --tags
```

### 5. Create GitHub Release

Create a new release on GitHub with the skill zip attached:

```bash
# Get the version from package.json
VERSION=$(node -p "require('./package.json').version")

# Create the release with the skill zip
gh release create "v$VERSION" \
  --title "v$VERSION" \
  --notes "See [CHANGELOG.md](CHANGELOG.md) for details." \
  dist/coach-skill.zip
```

Or manually:

1. Go to https://github.com/marijnvandevoorde/claude-coach/releases/new
2. Choose the tag you just pushed (e.g., `v0.1.0`)
3. Set the release title (e.g., `v0.1.0`)
4. Add release notes
5. Attach `dist/coach-skill.zip` as a binary
6. Click "Publish release"

## Quick Release Script

For convenience, here's a one-liner (after updating version):

```bash
npm run build:viewer && \
npm run build:skill && \
npm publish && \
git push origin main --tags && \
VERSION=$(node -p "require('./package.json').version") && \
gh release create "v$VERSION" --title "v$VERSION" --generate-notes dist/coach-skill.zip
```

## What Gets Released

| Artifact    | Destination                    | Contents                         |
| ----------- | ------------------------------ | -------------------------------- |
| npm package | npmjs.com/package/claude-coach | CLI tool, viewer builder         |
| Skill zip   | GitHub Releases                | `skill/` directory for Claude.ai |

## Verification

After releasing:

1. **npm**: Run `npx claude-coach --help` to verify the CLI works
2. **Skill**: Download the zip from GitHub releases, install in Claude.ai, and test
