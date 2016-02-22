github-changes [![NPM version](https://badge.fury.io/js/github-changes.png)](http://badge.fury.io/js/github-changes)
==============

Generate a changelog based on merged pull requests or commit messages

[![NPM](https://nodei.co/npm/github-changes.png)](https://nodei.co/npm/github-changes/)

[![Gitter](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/lalitkapoor/github-changes?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

### Installation

```
npm install -g github-changes
```

```
Usage: github-changes [options]

Options:
   -o, --owner         (required) owner of the Github repository
   -r, --repository    (required) name of the Github repository
   -d, --data          (DEPRECATED) use pull requests or commits (choices: pulls, commits)  [commits]
   -b, --branch        name of the default branch  [master]
   -n, --tag-name      tag name for upcoming release  [upcoming]
   -a, --auth          prompt to auth with Github - use this for private repos and higher rate limits
   -k, --token         need to use this or --auth for private repos and higher rate limits
   -f, --file          name of the file to output the changelog to  [CHANGELOG.md]
   -t, --title         title to appear in the top of the changelog  [Change Log]
   -m, --date-format   date format  [(YYYY/MM/DD HH:mm Z)]
   -v, --verbose       output details
   --host              alternate host name to use with github enterprise  [api.github.com]
   --path-prefix       path-prefix for use with github enterprise
   --between-tags      only diff between these two tags, separate by 3 dots ...
   --for-tag           only get changes for this tag
   --issue-body        (DEPRECATED) include the body of the issue (--data MUST equal 'pulls')
   --no-merges         do not include merges
   --only-merges       only include merges
   --only-pulls        only include pull requests
   --use-commit-body   use the commit body of a merge instead of the message - "Merge branch..."
   --order-semver      use semantic versioning for the ordering instead of the tag date
   --reverse-changes   reverse the order of changes within a release (show oldest first)
   --hide-tag-names    hide tag names in changelog
```

###Example usage

#### Generate changelog via pull requests
```bash
github-changes -o goodybag -r mongo-sql -a --only-pulls --use-commit-body
```

#### Output
    ## Change Log

    ### v2.3.3 (2014/02/20 00:22 +00:00)
    - [#83](https://github.com/goodybag/mongo-sql/pull/83) Buffer not defined in browser (@jrf0110)

    ### v2.3.2 (2014/02/19 23:54 +00:00)
    - [#82](https://github.com/goodybag/mongo-sql/pull/82) Preserve Buffer query values. (@alexmingoia)

    ### v2.3.1 (2014/02/08 23:01 +00:00)
    - [#81](https://github.com/goodybag/mongo-sql/pull/81) Casts + JSON derefs are malformed during the automated quoting (@jrf0110)

    ### v2.3.0 (2014/01/29 22:16 +00:00)
    - [#25](https://github.com/goodybag/mongo-sql/pull/25) Querying on JSON (@jrf0110)

    ### v2.2.14 (2014/01/27 22:35 +00:00)
    - [#78](https://github.com/goodybag/mongo-sql/pull/78) adding npm info (@lalitkapoor)
    - [#80](https://github.com/goodybag/mongo-sql/pull/80) $nin does not support Array (@jrf0110)

    ### v2.2.13 (2014/01/13 17:40 +00:00)
    - [#77](https://github.com/goodybag/mongo-sql/pull/77) Expose `quoteColumn` on root namespace (@prestonp)

    ### v2.2.12 (2013/11/26 20:57 +00:00)
    - [#76](https://github.com/goodybag/mongo-sql/pull/76) Dates not handled correctly in update where clause (@jrf0110)

    ### v2.2.11 (2013/11/15 15:46 +00:00)
    - [#74](https://github.com/goodybag/mongo-sql/pull/74) Drop constraint action needs options (@jrf0110)

    ### v2.2.10 (2013/11/15 06:03 +00:00)
    - [#73](https://github.com/goodybag/mongo-sql/pull/73) Action helper should accept an array of actions (@jrf0110)

    ### v2.2.9 (2013/11/12 05:05 +00:00)
    - [#70](https://github.com/goodybag/mongo-sql/pull/70) Window functions (@ProCynic)

    ...



#### Generate changelog via commit messages
```bash
github-changes -o npm -r npm -a
```

#### Output

    ## Change Log

    ### upcoming (2014/02/23 10:02 +00:00)
    - [70fd532](https://github.com/npm/npm/commit/70fd532c91335e76bda9366234b53a0498b9901a) fix prune.js test with empty cache (@robertkowalski)
    - [6fd6ff7](https://github.com/npm/npm/commit/6fd6ff7e536ea6acd33037b1878d4eca1f931985) Sort dependencies when --save'ing. (@domenic)
    - [2ddd060](https://github.com/npm/npm/commit/2ddd06037e9bd58cd95a380a9381ff90bea47f0d) add test, some boyscouting (@robertkowalski)
    - [17f07df](https://github.com/npm/npm/commit/17f07df8ad8e594304c2445bf7489cb53346f2c5) Add --save-exact config for --save[-dev|-optional]. (@timoxley)
    - [4b51920](https://github.com/npm/npm/commit/4b5192071654e2b312a7678b7586e435be62f473) Prevent creation of node_modules/npm-4503-c (@timoxley)
    - [30b6783](https://github.com/npm/npm/commit/30b67836b51b68614c9e87dc476c0961d53ec6d4) doc: update misc/semver.md (@isaacs)

    ### v1.4.4 (2014/02/20 16:04 +00:00)
    - [05d2490](https://github.com/npm/npm/commit/05d2490526fa40adc55727e92d4d30bd63aabaad) uid-number@0.0.4 (@isaacs)
    - [3850441](https://github.com/npm/npm/commit/3850441fd8c2fd71ebfd8e9986bc5f2e482ab6db) Document the --tag option of npm-publish (@kriskowal)
    - [14e650b](https://github.com/npm/npm/commit/14e650bce0bfebba10094c961ac104a61417a5de) alias 't' to 'test' (@isaacs)
    - [d50b826](https://github.com/npm/npm/commit/d50b826b9e5884c0f4e1101b90c7206a138a43e7) uid-number@0.0.5 (@isaacs)
    - [cd7e4a2](https://github.com/npm/npm/commit/cd7e4a23037f3ae1928bac02332784ffab557be9) v1.4.4 (@isaacs)

    ### v1.4.3 (2014/02/17 04:37 +00:00)
    - [3ce6905](https://github.com/npm/npm/commit/3ce6905bf6b0963956d7dbb8a89fc29d379de91c) view: remove arbitrary cache limit (@isaacs)
    - [bb6fb4d](https://github.com/npm/npm/commit/bb6fb4d158f175ddeb2956b361f854c273b6bed0) read-installed@1.0.0 (@isaacs)
    - [caa7065](https://github.com/npm/npm/commit/caa7065b06ffb55ea3410e5a14ddc80c26844b13) new tests for read-installed (@isaacs)
    - [401a642](https://github.com/npm/npm/commit/401a64286aa6665a94d1d2f13604f7014c5fce87) link: do not allow linking unnamed packages (@isaacs)
    - [09223de](https://github.com/npm/npm/commit/09223de8778b3e8fb0ecfec82cf6058d2c659518) Forbid deleting important npm dirs (@isaacs)
    - [86028e9](https://github.com/npm/npm/commit/86028e9fd8524d5e520ce01ba2ebab5a030103fc) dedupe: respect dependency versions (@rafeca)
    - [02d4322](https://github.com/npm/npm/commit/02d4322cd4f67a078a29019d2c4ef591b281132c) Follow redirects on curl|sh installer script (@isaacs)
    - [8a26f6f](https://github.com/npm/npm/commit/8a26f6ff7e9769985f74b60eed54e488a4d4a804) Test for repo command (@isaacs)
    - [acc4d02](https://github.com/npm/npm/commit/acc4d023c57d07704b20a0955e4bf10ee91bdc83) prune: Added back --production support (@davglass)
    - [0a3151c](https://github.com/npm/npm/commit/0a3151c9cbeb50c1c65895685c2eabdc7e2608dc) default to ^ instead of ~ (@mikolalysenko)
    - [9ae71de](https://github.com/npm/npm/commit/9ae71de7802132c349c60f1b740a734761fec4a1) npm-registry-client@0.4.4 (@isaacs)
    - [46d8768](https://github.com/npm/npm/commit/46d876821d1dd94c050d5ebc86444bed12c56739) "install ./pkg@1.2.3" should install local module (@rlidwka)
    - [f469847](https://github.com/npm/npm/commit/f46984787e8bb219cfd1d8394932dca2ed6b3b2c) test: express is not in mocks, use underscore instead (@isaacs)

    ...

### Using with Grunt

If you want to generate a changelog within a grunt workflow, [a grunt plugin] (https://github.com/streetlight/grunt-github-changes) that can be utilized. To install:

```
npm install grunt-github-changes --save-dev
```

For further details and specifics on how to use (and to contribute), see [grunt-github-changes](https://github.com/streetlight/grunt-github-changes).
