var db = require('level')('/tmp/mail.db');
var mail = require('../')(db, { dir: '/tmp/maildir' });

var box = process.argv[2];
var seqset = process.argv[3];
var field = process.argv[4];
mail.fetch(box, seqset, field).on('data', console.log);
