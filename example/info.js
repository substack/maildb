var db = require('level')('/tmp/mail.db');
var mail = require('../')(db, { dir: '/tmp/maildir' });

mail.info(function (err, info) {
    console.log(info);
});
