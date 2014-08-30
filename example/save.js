var db = require('level')('/tmp/mail.db');
var mail = require('../')(db, { dir: '/tmp/maildir' });

var from = process.argv[2];
var to = process.argv[3];
process.stdin.pipe(mail.save(from, to));
