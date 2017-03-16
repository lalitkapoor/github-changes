#!/usr/bin/env bash

set -e
set -u
set -o pipefail

if [ $# -ne 1 ]
  then
    echo "must specify a semver value (major, minor, patch)"
    exit
fi

if ([ "$1" != "major" ] && [ "$1" != "minor" ] && [ "$1" != "patch" ])
  then
    echo "please specify one of (major, minor, patch)"
    exit
fi

git checkout master
npm install
npm version $1
VERSION=`cat package.json | json version`
node bin/index.js -o lalitkapoor -r github-changes --only-pulls -v -a --use-commit-body --reverse-changes -n v$VERSION
git add CHANGELOG.md
git commit --amend --no-edit
git push origin master
git push origin --tags
npm publish
