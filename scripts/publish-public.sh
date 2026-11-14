#!/usr/bin/env sh
# Publish the development branch to the public repository.
#
# The two repositories share one history, so this is a plain fast-forward push:
# no snapshot commits and no duplicated content. A PR merged on the public repo
# is brought back with `git merge public/main`, not copied with cherry-pick.
#
# Usage:
#   git remote add public https://github.com/WhelkMail/WhelkMail.git
#   sh scripts/publish-public.sh                 # publish main
#   SOURCE=feature-x sh scripts/publish-public.sh
set -eu

REMOTE=${REMOTE:-public}
SOURCE=${SOURCE:-main}
TARGET=${TARGET:-main}

die() {
  echo "error: $*" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || die "git not found"
git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository"

# Never publish files that describe a specific installation.
for file in wrangler.toml worker/wrangler.toml .dev.vars; do
  if git cat-file -e "$SOURCE:$file" 2>/dev/null; then
    die "$file is tracked in $SOURCE; untrack it with: git rm --cached $file"
  fi
done

git fetch "$REMOTE" "$TARGET" >/dev/null 2>&1 || die "cannot fetch $REMOTE/$TARGET"

# Only fast-forwards: the public line is part of this history, so a rewrite would
# mean someone merged something that was never brought back here.
if ! git merge-base --is-ancestor "$REMOTE/$TARGET" "$SOURCE"; then
  die "$REMOTE/$TARGET has commits missing from $SOURCE; run 'git merge $REMOTE/$TARGET' first"
fi

echo "publishing $SOURCE -> $REMOTE/$TARGET"
git --no-pager diff --stat "$REMOTE/$TARGET" "$SOURCE" | tail -n 20
echo
git push "$REMOTE" "$SOURCE:$TARGET"
echo "done: $(git rev-parse --short "$SOURCE")"
