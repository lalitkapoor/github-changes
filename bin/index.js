#!/usr/bin/env node

// Overwrite global promise, so GithubApi will use bluebird too.
Promise = require("bluebird");

const fs = require('fs');
const _ = require('lodash');
const http = require('http');
const https = require('https');
const domain = require('domain');
const moment = require('moment-timezone');
const parser = require('commander');
const semver = require('semver');
const { Octokit } = require("@octokit/rest")
const ghauth = Promise.promisify(require('ghauth'));

// Increase number of concurrent requests
http.globalAgent.maxSockets = 30;
https.globalAgent.maxSockets = 30;

// It might be faster to just go through commits on the branch
// instead of iterating over closed issues, look into this later.
//
// Even better yet. I might just be able to do this with git log.
// tags: git log --tags --simplify-by-decoration --format="%ci%n%d"
// prs: git log --grep="Merge pull request #" --format="%s%n%ci%n%b"

// parse cli options
var opts = parser
  .version(require('../package.json').version)
  .requiredOption('-o, --owner <name>', '(required) owner of the Github repository')
  .requiredOption('-r, --repository <name>', '(required) name of the Github repository')
  .option('-d, --data [type]', '(DEPRECATED) use pull requests or commits (choices: pulls, commits)', 'commits')
  .option('-b, --branch [name]', 'name of the default branch', 'master')
  .option('-n, --tag-name [name]', 'tag name for upcoming release', 'upcoming')
  .option('-a, --auth', 'prompt to auth with Github - use this for private repos and higher rate limits')
  .option('-k, --token [token]', 'need to use this or --auth for private repos and higher rate limits')
  .option('-f, --file [name]', 'name of the file to output the changelog to', 'CHANGELOG.md')
  .option('-t, --title [title]', 'title to appear in the top of the changelog', 'Change Log')
  .option('-z, --time-zone [zone]', 'time zone', 'UTC')
  .option('-m, --date-format [format]', 'date format', '(YYYY/MM/DD HH:mm Z)')
  .option('-v, --verbose', 'output details')
  .option('--host [domain]', 'alternate host name to use with github enterprise', 'api.github.com')
  .option('--path-prefix [path]', 'path-prefix for use with github enterprise')
  .option('--between-tags [range]', 'only diff between these two tags, separate by 3 dots ...')
  .option('--issue-body', '(DEPRECATED) include the body of the issue (--data MUST equal \'pulls\')')
  .option('--for-tag [tag]', 'only get changes for this tag')
  .option('--no-merges', 'do not include merges')
  .option('--only-merges', 'only include merges')
  .option('--only-pulls', 'only include pull requests')
  .option('--use-commit-body', 'use the commit body of a merge instead of the message - "Merge branch..."')
  .option('--order-semver', 'use semantic versioning for the ordering instead of the tag date')
  .option('--reverse-changes', 'reverse the order of changes within a release (show oldest first)')
  .option('--hide-tag-names', 'hide tag names in changelog')
  .option('--timeout [milliseconds]', 'Github API timeout', 10000)
  .parse(process.argv);

if (opts.onlyPulls) opts.merges = true;

var betweenTags = [null, null];
var betweenTagsNames = null;

if (opts.betweenTags) {
  if (!opts.betweenTags.length) {
    return console.error(`Invalid value for --between-tags. Please specify two tags separated by 3 dots ...`);
  }

  betweenTagsNames = opts.betweenTags.split('...');
  if (!betweenTagsNames[0] || !betweenTagsNames[1]) {
    return console.error(`Invalid value for --between-tags. Please specify two tags separated by 3 dots ...`);
  }
}

var forTag = opts.forTag;

var commitsBySha = {}; // populated when calling getAllCommits
var currentDate = moment();

var github = null;

// github auth token
var token = null;

// ~/.config/changelog.json will store the token
var authOptions = {
  clientId   : '899aa18ee35dbb76c97c'
, configName : 'changelog'
, scopes     : ['user', 'public_repo', 'repo']
};

// TODO: Could probably fetch releases so we don't have to get the commit data
// for the sha of each tag to figure out the date. Could save alot on api
// calls.
var getTags = function(){
  var tagOpts = {
    owner: opts.owner
  , repo: opts.repository
  , per_page: 100
  };

  return github.repos.listTags(tagOpts)
    .then(result => result.data)
    .then(tagArray => {
      // check that the tags asked for exist (--between-tags)
      if (betweenTagsNames) {
        const tagNames = tagArray.map(e => e.name);
        if (!tagNames.includes(betweenTagsNames[0])) {
          console.error(`Tag ${betweenTagsNames[0]} was given as a first value of --between-tags but it doesn't exist in repository`);
          process.exit(1);
        }
        if (!tagNames.includes(betweenTagsNames[1])) {
          console.error(`Tag ${betweenTagsNames[1]} was given as a second value of --between-tags but it doesn't exist in repository`);
          process.exit(1);
        }
      }

      return tagArray;
    })
    .map(function(ref){
      return github.repos.getCommit({
          owner: tagOpts.owner
        , repo: tagOpts.repo
        , ref: ref.commit.sha
      }).then(function({data: commit}){
        opts.verbose && console.log('pulled commit data for tag - ', ref.name);
        var tag = {
            name: ref.name
          , date: moment(commit.commit.committer.date)
        };

        // if --between-tags is specified then reference the appropriate tag
        if (betweenTagsNames && (betweenTagsNames.indexOf(tag.name)>-1)) {
          betweenTags[betweenTagsNames.indexOf(tag.name)] = tag;
        }

        return tag;
      });
    });
};

var _getAllPullRequests = function(page = 1) {
  return github.pulls.list({
      owner: opts.owner
    , repo: opts.repository
    , base: opts.branch
    , state: 'closed'
    , sort: 'updated'
    , direction: 'desc'
    , per_page: 100
    , page: page
    // , since: null // TODO: this is an improvement to save API calls
  })
    .then(result => {
      opts.verbose && console.log('fetched %d pull requests', ((page - 1) * 100) + result.data.length)

      var pulls = result.data.filter(pr => pr.merged_at !== null);

      if (result.headers.link && result.headers.link.indexOf('rel="next"') > 0) {
        return _getAllPullRequests(page + 1).then(list => pulls.concat(list));
      }

      return pulls;
    })
  ;
};

var getPullRequests = function() {
  opts.verbose && console.log('fetching pull requests');

  return _getAllPullRequests().then(pulls => {
    opts.verbose && console.log('fetched all pull requests');
    return pulls;
  });
};

var _getAllCommits = function(page = 1) {
  return github.repos.listCommits({
      owner: opts.owner
    , repo: opts.repository
    , sha: opts.branch
    , per_page: 100
    , page: page
    })
    .then(result => {
      opts.verbose && console.log('fetched %d commits', ((page - 1) * 100) + result.data.length)

      var commits = result.data.slice();

      result.data.forEach(commit => {
        commitsBySha[commit.sha] = commit;
      });

      if (result.headers.link && result.headers.link.indexOf('rel="next"') > 0) {
        return _getAllCommits(page + 1).then(list => commits.concat(list));
      }
      return commits;
    });
};

var getAllCommits = function() {
  opts.verbose && console.log('fetching commits');

  return _getAllCommits().then(commits => {
    opts.verbose && console.log('fetched all commits');
    return commits;
  });
};

var getData = function() {
  if (opts.data === 'commits') return getAllCommits();
  return getPullRequests();
};

var tagger = function(sortedTags, data) {
  var date = null;
  if (opts.data === 'commits') date = moment(data.commit.committer.date);
  else date = moment(data.merged_at);

  var current = null;
  for (var i=0, len=sortedTags.length; i < len; i++) {
    var tag = sortedTags[i];
    if (tag.date < date) break;
    current = tag;
  }
  if (!current) current = {name: opts.tagName, date: currentDate};
  return current;
};

var prFormatter = function(data) {
  var currentTagName = '';
  var output = "## " + opts.title + "\n";
  data.forEach(function(pr){
    if (!opts.hideTagNames) {
      if (pr.tag === null) {
        currentTagName = opts.TagName;
        output+= "\n### " + opts.tagName;
        output+= "\n";
      } else if (pr.tag.name != currentTagName) {
        currentTagName = pr.tag.name;
        output+= "\n### " + pr.tag.name
        output+= " " + pr.tag.date.tz(opts.timeZone).format(opts.dateFormat);
        output+= "\n";
      }
    }

    output += "- [#" + pr.number + "](" + pr.html_url + ") " + pr.title
    if (pr.user && pr.user.login) output += " (@" + pr.user.login + ")";
    if (opts.issueBody && pr.body && pr.body.trim()) output += "\n\n    >" + pr.body.trim().replace(/\n/ig, "\n    > ") +"\n";

    // output += " " + moment(pr.merged_at).utc().format(opts.dateFormat);
    output += "\n";
  });
  return output.trim() + "\n";
};

var getCommitsInMerge = function(mergeCommit) {
  // direct descendents of the mergeCommit
  var directDescendents = {};

  // store reachable commits
  var store1 = {};
  var store2 = {};

  var currentCommit = mergeCommit;
  while (currentCommit && currentCommit.parents && currentCommit.parents.length > 0) {
    directDescendents[currentCommit.parents[0].sha] = true;
    currentCommit = commitsBySha[currentCommit.parents[0].sha];
  }

  var getAllReachableCommits = function(sha, store) {
    if (!commitsBySha[sha]) return;
    store[sha]=true;
    commitsBySha[sha].parents.forEach(function(parent){
      if (directDescendents[parent.sha]) return;
      if (store[parent.sha]) return; // don't revist commits we've explored
      return getAllReachableCommits(parent.sha, store);
    })
  };

  var parentShas = _.map(mergeCommit.parents, 'sha');
  var notSha = parentShas.shift(); // value to pass to --not flag in git log
  parentShas.forEach(function(sha){
    return getAllReachableCommits(sha, store1);
  });
  getAllReachableCommits(notSha, store2);

  return _.difference(
    Object.keys(store1)
  , Object.keys(store2)
  ).map(function(sha){
    return commitsBySha[sha];
  });
};

var commitFormatter = function(data) {
  var currentTagName = '';
  var output = "## " + opts.title + "\n";
  data.forEach(function(commit){
    if (betweenTagsNames && commit.tag.date<=betweenTags[0].date) return;
    if (betweenTagsNames && betweenTags[1] && commit.tag.date>betweenTags[1].date) return;
    if (forTag && commit.tag.name !== forTag) return;

    var isMerge = (commit.parents.length > 1);
    var isPull = isMerge && /^Merge pull request #/i.test(commit.commit.message);
    var isSquashAndMerge = false;

    // handle checking for a squash & merge
    if (!isPull) {
      isPull = /\s\(\#\d+\)/i.test(commit.commit.message); //contains ' (#123)'?
      if (isPull) {
        isMerge = true;
        isSquashAndMerge = true;
      }
    }

    // exits
    if ((opts.merges === false) && isMerge) return '';
    if ((opts.onlyMerges) && commit.parents.length < 2) return '';
    if ((opts.onlyPulls) && !isPull) return '';

    // choose message content
    var messages = commit.commit.message.split('\n');
    var message = messages.shift().trim();

    if (!isSquashAndMerge && opts.useCommitBody && commit.parents.length > 1) {
      message = messages.join(' ').trim() || message;
    }

    if (!opts.hideTagNames) {
      if (commit.tag === null) {
        currentTagName = opts.tagName;
        output+= "\n### " + opts.tagName;
        output+= "\n";
      } else if (commit.tag.name != currentTagName) {
        currentTagName = commit.tag.name;
        output+= "\n### " + commit.tag.name
        output+= " " + commit.tag.date.tz(opts.timeZone).format(opts.dateFormat);
        output+= "\n";
      }
    }

    // if commit is a merge then find all commits that belong to the merge
    // and extract authors out of those. Do this for --only-merges and for
    // --only-pulls
    var authors = {};
    if (isMerge && (opts.onlyMerges || opts.onlyPulls)) {
      getCommitsInMerge(commit).forEach(function(c){
        // ignore the author of a merge commit, they might have reviewed,
        // resolved conflicts, and merged, but I don't think this alone
        // should result in them being considered one of the authors in
        // the pull request
        if (c.parents.length > 1) return;

        if (c.author && c.author.login) {
          authors[c.author.login] = true;
        }
      });
    }
    authors = Object.keys(authors);

    // if it's a pull request, then the link should be to the pull request
    if (isPull) {
      var prNumber = null;
      var author = null;
      var authorName = commit.commit.author && commit.commit.author.name;

      if (isSquashAndMerge) {
        prNumber = commit.commit.message.match(/\(#\d+\)/)[0].replace(/\(|\)|#/g,'');
        author = (commit.author && commit.author.login);
      } else {
        prNumber = commit.commit.message.split('#')[1].split(' ')[0];
        author = (commit.commit.message.split(/\#\d+\sfrom\s/)[1]||'').split('/')[0];
      }


      var host = (opts.host === 'api.github.com') ? 'github.com' : opts.host;
      var url = "https://"+host+"/"+opts.owner+"/"+opts.repository+"/pull/"+prNumber;
      output += "- [#" + prNumber + "](" + url + ") " + message;

      if (authors.length) {
        output += ' (' + authors.map(function(author){return '@' + author}).join(', ') + ')';
      } else if (author) {
        output += " (@" + author + ")";
      } else if (authorName) {
        output += " (" + authorName + ")";
      }

    } else { //otherwise link to the commit
      output += "- [" + commit.sha.substr(0, 7) + "](" + commit.html_url + ") " + message;

      if (authors.length)
        output += ' (' + authors.map(function(author){return '@' + author}).join(', ') + ')';
      else if (commit.author && commit.author.login)
        output += " (@" + commit.author.login + ")";
    }

    // output += " " + moment(commit.commit.committer.date).utc().format(opts.dateFormat);
    output += "\n";
  });
  return output.trim();
};

var formatter = function(data) {
  if (opts.data === 'commits') return commitFormatter(data);
  return prFormatter(data);
};

var getGithubToken = function() {
  if (opts.token) return Promise.resolve({token: opts.token});
  if (opts.auth) return ghauth(authOptions);
  return Promise.resolve({});
};

var task = function() {
  getGithubToken()
    .then(function(authData){
      if (authData.token) token = authData.token;

      github = new Octokit({
        version: '3.0.0'
      , protocol: 'https'
      , pathPrefix: opts.pathPrefix
      , host: opts.host
      , request: {
          timeout: opts.timeout
        }
      , auth: token
      });
    })
    .then(function(){
      return Promise.all([getTags(), getData()])
    })
    .spread(function(tags, data){
      allTags = _.sortBy(tags, 'date').reverse();
      return data;
    })
    .map(function(data){
      data.tag = tagger(allTags, data);
      data.tagDate = data.tag.date;
      return data;
    })
    .then(function(data){
      // order by commit date DESC by default / ASC if --reverse-changes given
      var compareSign = (opts.reverseChanges) ? -1 : 1;

      // order by tag date then commit date
      if (!opts.orderSemver && opts.data === 'commits') {
        data = data.sort(function(a,b){
          var tagCompare = (a.tagDate - b.tagDate);
          return (tagCompare) ? tagCompare : compareSign * (moment(a.commit.committer.date) - moment(b.commit.committer.date));
        }).reverse();
        return data;
      } else if (!opts.orderSemver && opts.data === 'pulls') {
        data = data.sort(function(a,b){
          var tagCompare = (a.tagDate - b.tagDate);
          return (tagCompare) ? tagCompare : compareSign * (moment(a.merged_at) - moment(b.merged_at));
        }).reverse();
        return data;
      }

      // order by semver then commit date
      data = data.sort(function(a,b){
        var tagCompare = 0;
        if (a.tag.name === b.tag.name) tagCompare = 0;
        else if (a.tag.name === opts.tagName) tagCompare = 1;
        else if (b.tag.name === opts.tagName) tagCompare -1;
        else tagCompare = semver.compare(a.tag.name, b.tag.name);
        return (tagCompare) ? tagCompare : compareSign * (moment(a.commit.committer.date) - moment(b.commit.committer.date));
      }).reverse();
      return data;
    })
    .then(function(data){
      fs.writeFileSync(opts.file, formatter(data));
    })
    .then(function(){
      process.exit(0);
    })
    .catch(function(error){
      console.error('error', error);
      console.error('stack', error.stack);
      process.exit(1);
    })
  ;
};

var done = function (error) {
  if (!error) process.exit(0);
  console.log(error);
  console.log(error.stack);
  process.exit(1);
};

var runner = function () {
  var d = domain.create();
  d.on('error', done);
  d.run(task);
};

runner();
