var parser = require('nomnom');
var fs = require('fs');
var _ = require('lodash');
var moment = require('moment');
var Promise = require("bluebird");
var GithubApi = require('github');
var ghauth = Promise.promisify(require('ghauth'));

opts = parser
  .option('username', {
    abbr: 'u'
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
  .option('token', {
    abbr: 'k'
  , help: '(optional) if not provided will prompt on authentication on first run'
  })
  .option('file', {
    abbr: 'f'
  , help: '(optional) name of the file to output the changelog to'
  , default: 'CHANGELOG.md'
  })
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
    user: opts.username
  , repo: opts.repository
  };
  return github.repos.getTagsAsync(tagOpts).map(function(ref){
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
    user: opts.username
  , repo: opts.repository
  , state: 'closed'
  , sort: 'updated'
  , direction: 'desc'
  , per_page: 100
  , page: 1
  // , since: null // TODO: this is an improvement to save API calls
  };

  var getAllIssues = function(options, allIssues){
    if (!allIssues) allIssues = [];
    return github.issues.repoIssuesAsync(options).then(function(issues){
      allIssues = allIssues.concat(issues);
      console.log('issues pulled - ', issues.length);
      console.log('issues page - ', options.page);
      if (issues.length >= 100) {
        options.page++;
        return getAllIssues(options, allIssues);
      }
      return allIssues;
    });
  };

  return getAllIssues(issueOpts).map(function(issue){
    if (!issue.pull_request.html_url) return;

    return github.pullRequests.getAsync({
      user: issueOpts.user
    , repo: issueOpts.repo
    , number: issue.number
    }).then(function(pr){
      if (pr.base.ref !== opts.branch) return;
      if (!pr.merged_at) return;
      return {
        title: pr.title
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
  if (!current) current = {name: 'LATEST', date: currentDate};
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
      if (currentTagName != opts.tagname) output+= " (" + pr.tag.date.utc().format("YYYY/MM/DD HH:mm Z") + ")";
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
    output += "\n";
  });
  return output.trim();
};

var getGithubToken = function() {
  if (opts.token) return Promise.resolve({token: opts.token});
  return ghauth(authOptions);
};

// It might be faster to just go through commits on the branch
// instead of iterating over closed issues, look into this later

getGithubToken()
  .then(function(authData){
    github.authenticate({
      type: 'oauth'
    , token: authData.token
    });
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