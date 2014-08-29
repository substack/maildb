var db = require('level')('/tmp/mail.db');
var mail = require('../')(db);

mail.search('unread').on('data', console.log);
