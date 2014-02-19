var parser = require('nomnom');
var fs = require('fs');
var _ = require('lodash');
var moment = require('moment');
var Promise = require("bluebird");
var GithubApi = require('github');
var linkParser = require('parse-link-header');
var ghauth = Promise.promisify(require('ghauth'));

// It might be faster to just go through commits on the branch
// instead of iterating over closed issues, look into this later.
//
// Even better yet. I might just be able to do this with git log.
// tags: git log --tags --simplify-by-decoration --format="%ci%n%d"
// prs: git log --grep="Merge pull request #" --format="%s%n%ci%n%b"

opts = parser
  .option('owner', {
    abbr: 'o'
  , help: 'owner of the Github repository'
  , required: true
  })
  .option('repository', {
    abbr: 'r'
  , help: 'name of the Github repository'
  , required: true
  })
  .option('branch', {
    abbr: 'b'
  , help: '(optional) name of the default branch'
  , default: 'master'
  })
  .option('tagname', {
    abbr: 'n'
  , help: '(optional) tag name for upcoming release'
  , default: 'upcoming'
  })
  .option('issuebody', {
    abbr: 'i'
  , help: '(optional) include the body of the issue'
  , flag: true
  })
  .option('auth', {
    abbr: 'a'
  , help: '(optional) prompt to auth with Github - use this for private repos'
  , flag: true
  })
  .option('token', {
    abbr: 'k'
  , help: '(optional) need to use this or --auth for private repos'
  })
  .option('file', {
    abbr: 'f'
  , help: '(optional) name of the file to output the changelog to'
  , default: 'CHANGELOG.md'
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
      console.log('issues pulled - ', issues.length);
      console.log('issues page - ', options.page);
      return issues;
    });
  };

  return getIssues(issueOpts).then(function(issues){
    var totalPages = linkParser(issues.meta.link).last.page;

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
      return {
        title: pr.title
      , body: pr.body
      , number: pr.number
      , html_url: pr.html_url
      , 'merged_at': moment(pr.merged_at)
      , user: {login: (pr.user||0).login || null}
      };
    });
  }).reduce(function(scrubbed, pr){
    if (pr) scrubbed.push(pr);
    return scrubbed;
  }, [])
  // this is to get all committers, commenting out to reduce number of requests
  // .map(function(pr){
  //   return github.pullRequests.getCommitsAsync({
  //     user: meta.user
  //   , repo: meta.repo
  //   , number: pr.number
  //   , per_page: 100
  //   }).reduce(function(committers, commit){
  //     // get committers
  //     if (!commit || !commit.author || !commit.author.login) return committers;
  //     if (committers.indexOf(commit.author.login) === -1) committers.push(commit.author.login);
  //     return committers;
  //   }, []).then(function(committers){
  //     pr.committers = committers;
  //     return pr;
  //   });
  // })
  .then(function(prs){
    return prs;
  });
};


// sortedTags must be an array of tag data sorted by tag date DESC
var tagPr = function(sortedTags, pr) {
  var current = null;
  for (var i=0, len=sortedTags.length; i < len; i++) {
    var tag = sortedTags[i];
    if (tag.date < pr.merged_at) break;
    current = tag;
  }
  if (!current) current = {name: opts.tagname, date: currentDate};
  return current;
};

var formatter = function(data) {
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

    // prepend with @ because these are the github usernames
    // var committers = [];
    // pr.committers.forEach(function(committer){
    //   committers.push("@"+committer);
    // });
    // output += "- [#" + pr.number + "](" + pr.html_url + ") " + pr.title + " (" + committers.join(',') + ")";

    output += "- [#" + pr.number + "](" + pr.html_url + ") " + pr.title
    if (pr.user.login) output += " (@" + pr.user.login + ")";
    if (opts.issuebody && pr.body && pr.body.trim()) output += "\n\n    >" + pr.body.trim().replace(/\n/ig, "\n    > ");
    output += "\n\n";
  });
  return output.trim();
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

getGithubToken()
  .then(function(authData){
    if (!authData.token) return;
    token = authData.token;
  })
  .then(getTags)
  .then(function(tags){
    allTags = _.sortBy(tags, 'date').reverse();
    return;
  })
  .then(getPullRequests)
  .map(function(pr){
    pr.tag = tagPr(allTags, pr);
    pr.tagDate = pr.tag.date;
    return pr;
  })
  .then(function(data){
    data = _.sortBy(data, 'tagDate').reverse();
    // console.log(data);
    return data;
  })
  .then(function(data){
    fs.writeFileSync(opts.file, formatter(data));
  }).catch(function(error){
    console.log('error', error);
    console.log('stack', error.stack);
  })
;