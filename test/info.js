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

var messages = [
    {
        from: 'beep@boop.com',
        to: 'robot@substack.net',
        body: 'subject: one\n\nONE!'
    },
    {
        from: 'beep@boop.com',
        to: 'robot@substack.net',
        body: 'subject: two\n\nTWO!'
    },
    {
        from: 'tom@servo.com',
        to: 'robot@substack.net',
        body: 'subject: three\n\nTHREE!'
    },
    {
        from: 'tom@servo.com',
        to: 'xxx@substack.net',
        body: 'subject: four\n\nFOUR!'
    }
];

var expected = {};
expected.robot = {
    counts: { exists: 3, recent: 3, unseen: 3 },
    head: {
        unseen: '00c19ee7d325d1ab4b29b6672d56dbc30dd136bd7f96db71e96cdfcd104b6a69',
        exists: '00c19ee7d325d1ab4b29b6672d56dbc30dd136bd7f96db71e96cdfcd104b6a69',
        recent: '00c19ee7d325d1ab4b29b6672d56dbc30dd136bd7f96db71e96cdfcd104b6a69'
    }
}; 
expected.xxx = {
    counts: { exists: 1, recent: 1, unseen: 1 },
    head: {
        unseen: '61730c68aafadfc05df9b858708254f98cab57aceab94404a5d98ccbdaa6879e',
        exists: '61730c68aafadfc05df9b858708254f98cab57aceab94404a5d98ccbdaa6879e',
        recent: '61730c68aafadfc05df9b858708254f98cab57aceab94404a5d98ccbdaa6879e'
    }
};
expected.nosuch = {
    counts: { exists: 0, recent: 0, unseen: 0 },
    head: { unseen: null, exists: null, recent: null }
};

test('info', function (t) {
    t.plan(messages.length + 12);
    
    var pending = messages.length;
    messages.forEach(function (m) {
        var save = mail.save(m.from, m.to, done);
        save.end(m.body);
    });
    
    function done (err) {
        t.ifError(err);
        if (--pending !== 0) return;
        
        mail.info('robot@substack.net', function (err, info) {
            t.ifError(err);
            t.deepEqual(info, expected.robot);
        });
        mail.info('robot', function (err, info) {
            t.ifError(err);
            t.deepEqual(info, expected.robot);
        });
        
        mail.info('xxx@substack.net', function (err, info) {
            t.ifError(err);
            t.deepEqual(info, expected.xxx);
        });
        mail.info('xxx', function (err, info) {
            t.ifError(err);
            t.deepEqual(info, expected.xxx);
        });
        
        mail.info('nosuch@substack.net', function (err, info) {
            t.ifError(err);
            t.deepEqual(info, expected.nosuch);
        });
        mail.info('nosuch', function (err, info) {
            t.ifError(err);
            t.deepEqual(info, expected.nosuch);
        });
    }
});
