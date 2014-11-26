#!/usr/bin/env bash

set -e
set -u
set -o pipefail

git checkout master
npm version patch
VERSION=`cat package.json | json version`
node bin/index.js -o lalitkapoor -r github-changes --only-pulls -v -a --use-commit-body --reverse-changes -n v$VERSION
git add CHANGELOG.md
git commit --amend --no-edit
git push origin master
git push origin --tags
npm publish
