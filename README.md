github-changes
==============

Generate a changelog based on merged pull requests or commit messages

See the CHANGELOG.md file as an example

`npm install -g github-changes`

```
Usage: github-changes [options]

Options:
   -o, --owner        owner of the Github repository
   -r, --repository   name of the Github repository
   -d, --data         (optional) use pull requests or commits (choices: pulls, commits)  [pulls]
   -b, --branch       (optional) name of the default branch  [master]
   -n, --tagname      (optional) tag name for upcoming release  [upcoming]
   -i, --issuebody    (optional) include the body of the issue
   -a, --auth         (optional) prompt to auth with Github - use this for private repos and higher rate limits
   -k, --token        (optional) need to use this or --auth for private repos and higher rate limits
   -f, --file         (optional) name of the file to output the changelog to  [CHANGELOG.md]
   -v, --verbose      output details
```

###Example usage:
```bash
github-changes -o goodybag -r mongo-sql -a
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
