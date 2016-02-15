#!/usr/bin/env node

var fs = require('fs');
var _ = require('lodash');
var http = require('http');
var https = require('https');
var domain = require('domain');
var moment = require('moment');
var parser = require('nomnom');
var semver = require('semver');
var Promise = require("bluebird");
var GithubApi = require('github');
var linkParser = require('parse-link-header');
var ghauth = Promise.promisify(require('ghauth'));
var commitStream = require('github-commit-stream');

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
opts = parser
  .scriptName('github-changes')
  .option('owner', {
    abbr: 'o'
  , help: '(required) owner of the Github repository'
  , required: true
  })
  .option('repository', {
    abbr: 'r'
  , help: '(required) name of the Github repository'
  , required: true
  })
  .option('data', {
    abbr: 'd'
  , help: '(DEPRECATED) use pull requests or commits (choices: pulls, commits)'
  , choices: ['pulls', 'commits']
  , default: 'commits'
  })
  .option('branch', {
    abbr: 'b'
  , help: 'name of the default branch'
  , default: 'master'
  })
  .option('tag-name', {
    abbr: 'n'
  , help: 'tag name for upcoming release'
  , default: 'upcoming'
  })
  .option('auth', {
    abbr: 'a'
  , help: 'prompt to auth with Github - use this for private repos and higher rate limits'
  , flag: true
  })
  .option('token', {
    abbr: 'k'
  , help: 'need to use this or --auth for private repos and higher rate limits'
  })
  .option('file', {
    abbr: 'f'
  , help: 'name of the file to output the changelog to'
  , default: 'CHANGELOG.md'
  })
  .option('title', {
    abbr: 't'
  , help: 'title to appear in the top of the changelog'
  , default: 'Change Log'
  })
  .option('date-format', {
    abbr: 'm'
  , help: 'date format'
  , default: '(YYYY/MM/DD HH:mm Z)'
  })
  .option('verbose', {
    abbr: 'v'
  , help: 'output details'
  , flag: true
  })
  .option('host', {
    help: 'alternate host name to use with github enterprise'
  , default: 'api.github.com'
  })
  .option('path-prefix', {
    help: 'path-prefix for use with github enterprise'
  , default: null
  })
  .option('between-tags', {
    help: 'only diff between these two tags, separate by 3 dots ...'
  })
  .option('for-tag', {
    help: 'only get changes for this tag'
  })
  .option('issue-body', {
    help: '(DEPRECATED) include the body of the issue (--data MUST equal \'pulls\')'
  , flag: true
  })
  .option('no-merges', {
    help: 'do not include merges'
  , flag: true
  })
  .option('only-merges', {
    help: 'only include merges'
  , flag: true
  })
  .option('only-pulls', {
    help: 'only include pull requests'
  , flag: true
  })
  .option('use-commit-body', {
    help: 'use the commit body of a merge instead of the message - "Merge branch..."'
  , flag: true
  })
  .option('order-semver', {
    help: 'use semantic versioning for the ordering instead of the tag date'
  , flag: true
  })
  .option('reverse-changes', {
    help: 'reverse the order of changes within a release (show oldest first)'
  , flag: true
  })
  .option('hide-tag-names', {
    help: 'hide tag names in changelog'
  , flag: true
  })

  // TODO
  // .option('template', {
  //   abbr: 't'
  // , help: '(optional) template to use to generate the changelog'
  // })
  .parse()
;

if (opts['only-pulls']) opts.merges = true;

var betweenTags = [null, null];
var betweenTagsNames = null;
if (opts['between-tags']) betweenTagsNames = opts['between-tags'].split('...');

var forTag = opts['for-tag'];

var commitsBySha = {}; // populated when calling getAllCommits
var currentDate = moment();

var github = new GithubApi({
  version: '3.0.0'
, timeout: 10000
, protocol: 'https'
, pathPrefix: opts['path-prefix']
, host: opts.host
});

// github auth token
var token = null;

// ~/.config/changelog.json will store the token
var authOptions = {
  configName : 'changelog'
, scopes     : ['user', 'public_repo', 'repo']
};

Promise.promisifyAll(github.repos);
Promise.promisifyAll(github.issues);
Promise.promisifyAll(github.pullRequests);

// TODO: Could probably fetch releases so we don't have to get the commit data
// for the sha of each tag to figure out the date. Could save alot on api
// calls.
var getTags = function(){
  var tagOpts = {
    user: opts.owner
  , repo: opts.repository
  , per_page: 100
  };
  auth();
  return github.repos.getTagsAsync(tagOpts).map(function(ref){
    auth();
    return github.repos.getCommitAsync({
      user: tagOpts.user
    , repo: tagOpts.repo
    , sha: ref.commit.sha
    }).then(function(commit){
      opts.verbose && console.log('pulled commit data for tag - ', ref.name);
      var tag = {
        name: ref.name
      , date: moment(commit.commit.committer.date)
      };

      // if betweenTags is specified then
      if (betweenTagsNames && (betweenTagsNames.indexOf(tag.name)>-1)) {
        betweenTags[betweenTagsNames.indexOf(tag.name)] = tag;
      }

      return tag;
    });
  }).then(function(tags){
    return tags;
  });
};

var getPullRequests = function(){
  var issueOpts = {
    user: opts.owner
  , repo: opts.repository
  , state: 'closed'
  , sort: 'updated'
  , direction: 'desc'
  , per_page: 100
  , page: 1
  // , since: null // TODO: this is an improvement to save API calls
  };

  var getIssues = function(options){
    auth();
    return github.issues.repoIssuesAsync(options).then(function(issues){
      opts.verbose && console.log('issues pulled - ', issues.length);
      opts.verbose && console.log('issues page - ', options.page);
      return issues;
    });
  };

  return getIssues(issueOpts).then(function(issues){
    var linkHeader = linkParser(issues.meta.link)
    var totalPages = (linkHeader && linkHeader.last) ? linkHeader.last.page : 1;

    if (totalPages > issueOpts.page) {
      var allReqs = [];
      for(var i=issueOpts.page; i<totalPages; i++){
        var newOptions = _.clone(issueOpts, true);
        newOptions.page += i;
        allReqs.push(getIssues(newOptions));
      }
      return Promise.all(allReqs).reduce(function(issues, moreIssues){
        return issues.concat(moreIssues);
      }, issues);
    }
    return issues;
  }).map(function(issue){
    if (!issue.pull_request.html_url) return;

    auth();
    return github.pullRequests.getAsync({
      user: issueOpts.user
    , repo: issueOpts.repo
    , number: issue.number
    }).then(function(pr){
      if (pr.base.ref !== opts.branch) return;
      if (!pr.merged_at) return;
      return pr;
    });
  }).reduce(function(scrubbed, pr){
    if (pr) scrubbed.push(pr);
    return scrubbed;
  }, [])
  .then(function(prs){
    return prs;
  });
};

var getAllCommits = function() {
  var progress = 0;
  opts.verbose && console.log('fetching commits');
  return new Promise(function(resolve, reject){
    var commits = [];
    commitStream({
      token: token
    , host: opts.host
    , pathPrefix: (opts['path-prefix'] == '') ? '' : opts['path-prefix']
    , user: opts.owner
    , repo: opts.repository
    , sha: opts.branch
    , per_page: 100
    }).on('data', function(data){
      if (++progress % 100 == 0) {
        opts.verbose && console.log('fetched %d commits', progress)
      }
      commitsBySha[data.sha] = data;
      commits = commits.concat(data);
    }).on('end', function(error){
      if (error) return reject(error);
      opts.verbose && console.log('fetched all commits');
      return resolve(commits);
    });
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
  if (!current) current = {name: opts['tag-name'], date: currentDate};
  return current;
};

var prFormatter = function(data) {
  var currentTagName = '';
  var output = "## " + opts.title + "\n";
  data.forEach(function(pr){
    if (!opts['hide-tag-names']) {
      if (pr.tag === null) {
        currentTagName = opts['tag-name'];
        output+= "\n### " + opts['tag-name'];
        output+= "\n";
      } else if (pr.tag.name != currentTagName) {
        currentTagName = pr.tag.name;
        output+= "\n### " + pr.tag.name
        output+= " " + pr.tag.date.utc().format(opts['date-format']);
        output+= "\n";
      }
    }

    output += "- [#" + pr.number + "](" + pr.html_url + ") " + pr.title
    if (pr.user && pr.user.login) output += " (@" + pr.user.login + ")";
    if (opts['issue-body'] && pr.body && pr.body.trim()) output += "\n\n    >" + pr.body.trim().replace(/\n/ig, "\n    > ") +"\n";

    // output += " " + moment(pr.merged_at).utc().format(opts['date-format']);
    output += "\n";
  });
  return output.trim();
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

  var parentShas = _.pluck(mergeCommit.parents, 'sha');
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
    // exits
    if ((opts.merges === false) && isMerge) return '';
    if ((opts['only-merges']) && commit.parents.length < 2) return '';
    if ((opts['only-pulls']) && !isPull) return '';

    // choose message content
    var messages = commit.commit.message.split('\n');
    var message = messages.shift().trim();

    if (opts['use-commit-body'] && commit.parents.length > 1) {
      message = messages.join(' ').trim() || message;
    }

    if (!opts['hide-tag-names']) {
      if (commit.tag === null) {
        currentTagName = opts['tag-name'];
        output+= "\n### " + opts['tag-name'];
        output+= "\n";
      } else if (commit.tag.name != currentTagName) {
        currentTagName = commit.tag.name;
        output+= "\n### " + commit.tag.name
        output+= " " + commit.tag.date.utc().format(opts['date-format']);
        output+= "\n";
      }
    }

    // if commit is a merge then find all commits that belong to the merge
    // and extract authors out of those. Do this for --only-merges and for
    // --only-pulls
    var authors = {};
    if (isMerge && (opts['only-merges'] || opts['only-pulls'])) {
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
      var prNumber = commit.commit.message.split('#')[1].split(' ')[0];
      var author = (commit.commit.message.split(/\#\d+\sfrom\s/)[1]||'').split('/')[0];
      var host = (opts.host === 'api.github.com') ? 'github.com' : opts.host;
      var url = "https://"+host+"/"+opts.owner+"/"+opts.repository+"/pull/"+prNumber;
      output += "- [#" + prNumber + "](" + url + ") " + message;

      if (authors.length)
        output += ' (' + authors.map(function(author){return '@' + author}).join(', ') + ')';
      else
        output += " (@" + author + ")";
    } else { //otherwise link to the commit
      output += "- [" + commit.sha.substr(0, 7) + "](" + commit.html_url + ") " + message;

      if (authors.length)
        output += ' (' + authors.map(function(author){return '@' + author}).join(', ') + ')';
      else if (commit.author && commit.author.login)
        output += " (@" + commit.author.login + ")";
    }

    // output += " " + moment(commit.commit.committer.date).utc().format(opts['date-format']);
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

var auth = function() {
  if (!token) return;
  github.authenticate({type: 'oauth', token: token});
};

var task = function() {
  getGithubToken()
    .then(function(authData){
      if (!authData.token) return;
      token = authData.token;
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
      var compareSign = (opts['reverse-changes']) ? -1 : 1;

      // order by tag date then commit date
      if (!opts['order-semver'] && opts.data === 'commits') {
        data = data.sort(function(a,b){
          var tagCompare = (a.tagDate - b.tagDate);
          return (tagCompare) ? tagCompare : compareSign * (moment(a.commit.committer.date) - moment(b.commit.committer.date));
        }).reverse();
        return data;
      } else if (!opts['order-semver'] && opts.data === 'pulls') {
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
        else if (a.tag.name === opts['tag-name']) tagCompare = 1;
        else if (b.tag.name === opts['tag-name']) tagCompare -1;
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
