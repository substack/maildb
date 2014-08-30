var db = require('level')('/tmp/mail.db');
var mail = require('../')(db, { dir: '/tmp/maildir' });

var box = process.argv[2];
mail.info(box, function (err, info) {
    console.log(info);
});
