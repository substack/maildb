var db = require('level')('/tmp/mail.db');
var mail = require('../')(db, { dir: '/tmp/maildir' });

var box = process.argv[2];
mail.search(box, 'unread').on('data', console.log);
