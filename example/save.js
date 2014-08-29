var db = require('level')('/tmp/mail.db');
var mail = require('../')(db);

process.stdin.pipe(mail.save());
