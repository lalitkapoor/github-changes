github-changes
==============

Generate a changelog based on merged pull requests

See the CHANGELOG.md file as an example

`npm install -g github-changes`

```
Usage: github-changes [options]

Options:
   -o, --owner        owner of the Github repository
   -r, --repository   name of the Github repository
   -b, --branch       (optional) name of the default branch  [master]
   -n, --tagname      (optional) tag name for upcoming release  [upcoming]
   -i, --issuebody    (optional) include the body of the issue
   -a, --auth         (optional) prompt to auth with Github - use this for private repos and higher rate limits
   -k, --token        (optional) need to use this or --auth for private repos and higher rate limits
   -f, --file         (optional) name of the file to output the changelog to  [CHANGELOG.md]
   -v, --verbose      output details
```
