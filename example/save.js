var db = require('level')('/tmp/mail.db');
var mail = require('../')(db, { dir: '/tmp/maildir' });

process.stdin.pipe(mail.save());
