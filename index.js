var sublevel = require('level-sublevel/bytewise');
var bytewise = require('bytewise');
var cas = require('content-addressable-store');
var through = require('through2');
var split = require('split');
var headers = require('parse-header-stream');
var batch = require('level-create-batch');

module.exports = Mail;

function Mail (db, opts) {
    if (!(this instanceof Mail)) return new Mail(db, opts);
    if (!opts) opts = {};
    this.db = sublevel(db, {
        keyEncoding: bytewise,
        valueEncoding: 'json'
    });
    this.store = cas(opts.dir || './mail.db');
}

Mail.prototype.save = function () {
    var self = this;
    var stream = through();
    var rows = [];
    var h = stream.pipe(this.store.addStream());
    h.on('end', function () {
        batch(self.db, [
            { type: 'create', key: [ 'email', h.hash ], value: fields },
            { type: 'put', key: [ 'from', fields.from, h.hash ], value: 0 },
            { type: 'put', key: [ 'date', Date.now(), h.hash ], value: 0 },
            { type: 'put', key: [ 'recent', h.hash ], value: 0 },
            { type: 'put', key: [ 'unseen', h.hash ], value: 0 },
        ], function (err) { if (err) stream.emit('error', err) });
    });
    stream.pipe(headers(function (err, fields_) {
        if (err) stream.emit('error', err);
        fields = fields_;
    }));
    return stream;
};

Mail.prototype.info = function (indexes) {
    var db = this.db;
    var stream = db.createReadStream(opts);
    stream.pipe(through(function (row, enc, next) {
        seq ++;
        this.push({ seq: seq, key: hash });
        next();
    }));
};

Mail.prototype.search = function (query, cb) {
    var self = this;
    var stream = self.db.createReadStream({
        gt: [ 'date', null ],
        lt: [ 'date', undefined ]
    });
    var seq = 0, pending = 1;
    
    var results = stream.pipe(through.obj(function (row, enc, next) {
        var rseq = ++ seq;
        pending ++;
        self._match(query, row, function (err, matching) {
            if (matching) {
                var hash = row.key[2];
                results.push({ seq: seq, key: hash });
            }
            check();
        });
        next();
    }, check));
    
    function check () { if (-- pending === 0) results.push(null) }
    
    if (cb) {
        results.pipe(collect(cb));
        results.once('error', cb);
    }
    stream.once('error', function (err) { results.emit('error', err) });
    return results;
};

Mail.prototype._match = function (query, row, cb) {
    process.nextTick(function () { cb(null, true) }); // for now;
};

function collect (cb) {
    var rows = [];
    return through.obj(write, end);
    function write (row, enc, next) { rows.push(row); next() }
    function end () { cb(null, rows) }
}
