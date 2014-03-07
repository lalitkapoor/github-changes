#!/usr/bin/env node

var http = require('http');
var https = require('https');
var domain = require('domain');
var parser = require('nomnom');
var changes = require('../lib/changes');


// Increase number of concurrent requests
http.globalAgent.maxSockets = 30;
https.globalAgent.maxSockets = 30;

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
  .option('verbose', {
    abbr: 'v'
  , help: 'output details'
  , flag: true
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
  // TODO
  // .option('template', {
  //   abbr: 't'
  // , help: '(optional) template to use to generate the changelog'
  // })
  .parse()
;

if (opts['only-pulls']) opts.merges = true;

var task = function(){
  changes(opts)
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
