# maildb

leveldb and disk storage backend for email messages

# example

## save

save an email:

``` js
var db = require('level')('/tmp/mail.db');
var mail = require('maildb')(db, { dir: '/tmp/maildir' });

var from = process.argv[2];
var to = process.argv[3];
process.stdin.pipe(mail.save(from, to));
```

given this input:

```
Date: 23 Oct 81 11:22:33
From: SMTP@HOSTY.ARPA
To: JOE@HOSTW.ARPA
Subject: Mail System Problem

Sorry JOE, your message to SAM@HOSTZ.ARPA lost.

HOSTZ.ARPA said this:
 "550 No Such User"
```

Then save the email by doing:

```
$ node example/save.js alice@arpa.mil mail@substack.net < example/data.txt
```

## search

To see the previously saved email:

```
var db = require('level')('/tmp/mail.db');
var mail = require('maildb')(db, { dir: '/tmp/maildir' });

var box = process.argv[2];
mail.search(box, 'unread').on('data', console.log);
```

```
$ node search.js mail@substack.net
{ seq: 1,
  key: '6098da32e14b9cae0da533a1c87153171011107b6b892f37aa248973790ad800' }
```

## info

To get info about emails:

```
var db = require('level')('/tmp/mail.db');
var mail = require('maildb')(db, { dir: '/tmp/maildir' });

var box = process.argv[2];
mail.info(box, function (err, info) {
    console.log(info);
});
```

```
$ node info.js mail@substack.net
{ counts: { exists: 1, recent: 1, unseen: 1 },
  head: 
   { unseen: '6098da32e14b9cae0da533a1c87153171011107b6b892f37aa248973790ad800',
     exists: '6098da32e14b9cae0da533a1c87153171011107b6b892f37aa248973790ad800',
     recent: '6098da32e14b9cae0da533a1c87153171011107b6b892f37aa248973790ad800' } }
```

# methods

``` js
var maildb = require('maildb')
```

## var mailbox = maildb(db, opts)

Create a new `mailbox` from a leveldb handle `db` and options:

`opts.dir` - directory to store emails by the hash of their content

## var wstream = mailbox.save(from, recipients, cb)

Return a writable stream `wstream` to save an incoming email from an originator
string `from` to an array of string `recipients`. `wstream` should get the
entire email contents written to it, including headers.

Optionally pass in a `cb(err, key)` callback to capture any errors and the blob
store key.

## var rstream = mailbox.fetch(box, seqset, field)

Return a readable object stream `rstream` with the results for an IMAP-style
fetch request for the username at `box` given a sequence set string `seqset` of
the form `start:end` and a `field`. The stream will contain objects with a key
of the integer sequence number and a value based on the requested field.

Valid `field` values are:

* `'RFC822'`, `'BODY'` - TODO
* `'RFC822.SIZE'` - return the size of the message. `row.value` is the number of
bytes in the total message
* `'RFC822.HEADER'` - header content of the message. row.value is a stream with
`row.value.size` set to the size of the header content

## mailbox.info(box, cb)

Get the info for the account string `box` as `cb(err, info)`.

`info` contains:

* `info.head.unseen` - most recent message hash not yet read
* `info.head.recent` - most recent message hash marked as unread
* `info.head.exists` - most recent extant message hash
* `info.counts.exists` - count of total messages
* `info.counts.recent` - count of recent messages
* `info.counts.unseen` - count of unseen messages

## var rstream = mailbox.search(box, query, cb)

Search given an IMAP-style array of strings `query` for the given username
mailbox `box`.

Return a readable stream `rstream` or collect the results into `cb(err,
results)`. Each result is an object with a key hash property `key` and sequence
integer property `seq`.

## mailbox.store(box, seqset, type, fields, cb)

For a mailbox user account string `box` and `seqset`, a string of the form
`start:end` that refers to messages by their sequence numbers, tag each
matching message with `fields` according to `type` which
is a string that matches `/^[+-]?FLAGS(?:\.SILENT)?$/`.

`fields` is an array of case-insensitive string tags, optionally with a leading
`'\\'`. For example:

```
[ '\\Seen', '\\Deleted' ]
```

This format is taken directly from the RFC so that you can plug the values for
the `STORE` command directly into this method signature.

These arguments are documented in more detail in
[RFC 3501](http://www.faqs.org/rfcs/rfc3501.html) section 6.4.6.

## mailbox.expunge(box, cb)

Remove all messages in a mailbox user string `box` marked as deleted.
`cb(err, n)` fires with the number of deleted messages `n`.

# install

With [npm](https://npmjs.org) do:

```
npm install maildb
```

# license

MIT
