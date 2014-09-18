var level = require('level');
var maildb = require('../');
var test = require('tape');
var concat = require('concat-stream');
var mkdirp = require('mkdirp');

var path = require('path');
var tmpdir = path.join(
    require('osenv').tmpdir(),
    'maildb-test-' + Math.random()
);
var blobdir = path.join(tmpdir, 'blob');
mkdirp.sync(blobdir);

var db = level(path.join(tmpdir, 'db'));
var mail = maildb(db, { dir: blobdir });

test('save', function (t) {
    t.plan(2);
    
    var from = 'beep@beep.beep';
    var to = 'boop@boop.boop';
    var save = mail.save(from, to, function (err, key) {
        t.ifError(err);
        
        var rs = mail.blob.createReadStream({ key: key })
        rs.pipe(concat(function (body) {
            t.equal(body.toString('utf8'), 'subject: yo\n\nhey!');
        }));
    });
    save.end('subject: yo\n\nhey!');
});
