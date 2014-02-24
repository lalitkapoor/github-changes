#!/usr/bin/env node

var fs = require('fs');
var _ = require('lodash');
var http = require('http');
var https = require('https');
var domain = require('domain');
var moment = require('moment');
var parser = require('nomnom');
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
  , help: 'use pull requests or commits (choices: pulls, commits)'
  , choices: ['pulls', 'commits']
  , default: 'pulls'
  })
  .option('branch', {
    abbr: 'b'
  , help: 'name of the default branch'
  , default: 'master'
  })
  .option('tagname', {
    abbr: 'n'
  , help: 'tag name for upcoming release'
  , default: 'upcoming'
  })
  .option('issuebody', {
    abbr: 'i'
  , help: 'include the body of the issue'
  , flag: true
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
  .option('verbose', {
    abbr: 'v'
  , help: 'output details'
  , flag: true
  })
  // TODO
  // .option('template', {
  //   abbr: 't'
  // , help: '(optional) template to use to generate the changelog'
  // })
  .parse()
;


var currentDate = moment();

var github = new GithubApi({
  version: '3.0.0'
, timeout: 10000
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
      return {
        name: ref.name
      , date: moment(commit.commit.committer.date)
      };
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
  opts.verbose && console.log('fetching commits');
  return new Promise(function(resolve, reject){
    var commits = [];
    commitStream({
      token: token
    , user: opts.owner
    , repo: opts.repository
    , sha: opts.branch
    , per_page: 100
    }).on('data', function(data){
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
  if (!current) current = {name: opts.tagname, date: currentDate};
  return current;
};

var prFormatter = function(data) {
  var currentTagName = '';
  var output = "## Change Log\n";
  data.forEach(function(pr){
    if (pr.tag === null) {
      currentTagName = opts.tagname;
      output+= "\n### " + opts.tagname;
      output+= "\n";
    } else if (pr.tag.name != currentTagName) {
      currentTagName = pr.tag.name;
      output+= "\n### " + pr.tag.name
      output+= " (" + pr.tag.date.utc().format("YYYY/MM/DD HH:mm Z") + ")";
      output+= "\n";
    }

    output += "- [#" + pr.number + "](" + pr.html_url + ") " + pr.title
    if (pr.user && pr.user.login) output += " (@" + pr.user.login + ")";
    if (opts.issuebody && pr.body && pr.body.trim()) output += "\n\n    >" + pr.body.trim().replace(/\n/ig, "\n    > ") +"\n";
    output += "\n";
  });
  return output.trim();
};

var commitFormatter = function(data) {
  var currentTagName = '';
  var output = "## Change Log\n";
  data.forEach(function(commit){
    if (commit.tag === null) {
      currentTagName = opts.tagname;
      output+= "\n### " + opts.tagname;
      output+= "\n";
    } else if (commit.tag.name != currentTagName) {
      currentTagName = commit.tag.name;
      output+= "\n### " + commit.tag.name
      output+= " (" + commit.tag.date.utc().format("YYYY/MM/DD HH:mm Z") + ")";
      output+= "\n";
    }

    output += "- [" + commit.sha.substr(0, 7) + "](" + commit.html_url + ") " + commit.commit.message.split('\n')[0];
    if (commit.author && commit.author.login) output += " (@" + commit.author.login + ")";
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
      data = _.sortBy(data, 'tagDate').reverse();
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