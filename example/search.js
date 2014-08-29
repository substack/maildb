var db = require('level')('/tmp/mail.db');
var mail = require('../')(db, { dir: '/tmp/maildir' });

mail.search('unread').on('data', console.log);
