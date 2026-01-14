#!/bin/bash
# Bump version script for Avault
# Usage: ./scripts/bump-version.sh [major|minor|patch]

set -e

BUMP_TYPE=${1:-patch}

# Get current version from root package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"

# Calculate new version
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

case $BUMP_TYPE in
  major)
    NEW_VERSION="$((MAJOR + 1)).0.0"
    ;;
  minor)
    NEW_VERSION="$MAJOR.$((MINOR + 1)).0"
    ;;
  patch)
    NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
    ;;
  *)
    echo "Usage: $0 [major|minor|patch]"
    exit 1
    ;;
esac

echo "New version: $NEW_VERSION"

# Update all package.json files
for pkg in ./package.json ./apps/*/package.json ./packages/*/package.json; do
  if [ -f "$pkg" ]; then
    # Use node to update version (cross-platform)
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('$pkg'));
      pkg.version = '$NEW_VERSION';
      fs.writeFileSync('$pkg', JSON.stringify(pkg, null, 2) + '\n');
    "
    echo "Updated: $pkg"
  fi
done

# Update CHANGELOG.md with new version header
DATE=$(date +%Y-%m-%d)

# Create a temporary file for the new changelog content
node -e "
const fs = require('fs');
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');

// Add new version section after [Unreleased]
const newSection = \`## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [$NEW_VERSION] - $DATE\`;

const updated = changelog.replace(
  /## \[Unreleased\][\s\S]*?(?=## \[)/,
  newSection + '\n\n'
);

// Update the comparison links at the bottom
const repoUrl = 'https://github.com/drizki/avault';
const linkSection = \`[Unreleased]: \${repoUrl}/compare/v$NEW_VERSION...HEAD
[$NEW_VERSION]: \${repoUrl}/compare/v$CURRENT_VERSION...v$NEW_VERSION\`;

const finalChangelog = updated.replace(
  /\[Unreleased\]:.*(?:\n\[$CURRENT_VERSION\]:.*)?/,
  linkSection
);

fs.writeFileSync('CHANGELOG.md', finalChangelog);
"

echo ""
echo "Version bumped to $NEW_VERSION"
echo ""
echo "Next steps:"
echo "  1. Review and edit CHANGELOG.md (move items from [Unreleased] to [$NEW_VERSION])"
echo "  2. git add -A"
echo "  3. git commit -m 'chore: bump version to $NEW_VERSION'"
echo "  4. git tag -a v$NEW_VERSION -m 'Release v$NEW_VERSION'"
echo "  5. git push && git push --tags"
