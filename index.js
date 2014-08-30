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

Mail.prototype.save = function (from, to) {
    var self = this;
    to = to.toLowerCase();
    from = from.toLowerCase();
    
    var stream = through();
    var rows = [];
    var h = stream.pipe(this.store.addStream());
    h.on('end', function () {
        var now = Date.now();
        batch(self.db, [
            { type: 'create', key: [ 'email', to, h.hash ], value: fields },
            { type: 'put', key: [ 'from', to, from, h.hash ], value: 0 },
            { type: 'put', key: [ 'exists', to, now, h.hash ], value: 0 },
            { type: 'put', key: [ 'recent', to, now, h.hash ], value: 0 },
            { type: 'put', key: [ 'unseen', to, now, h.hash ], value: 0 },
        ], function (err) { if (err) stream.emit('error', err) });
    });
    stream.pipe(headers(function (err, fields_) {
        if (err) stream.emit('error', err);
        fields = fields_;
    }));
    return stream;
};

Mail.prototype.info = function (box, cb) {
    // todo: caching
    // exists, recent, first unseen
    
    var info = {
        counts: { exists: 0, recent: 0, unseen: 0 },
        head: { unseen: null, exists: null, recent: null }
    };
    var pending = 3;
    function done () { if (-- pending === 0) cb(null, info) }
    
    var estream = this.db.createReadStream({
        gt: [ 'exists', box, null ],
        lt: [ 'exists', box, undefined ]
    });
    var ustream = this.db.createReadStream({
        gt: [ 'unseen', box, null ],
        lt: [ 'unseen', box, undefined ]
    });
    var rstream = this.db.createReadStream({
        gt: [ 'recent', box, null ],
        lt: [ 'recent', box, undefined ]
    });
    
    function onerror (err) { cb(err); cb = function () {} }
    estream.on('error', onerror);
    rstream.on('error', onerror);
    ustream.on('error', onerror);
    
    estream.pipe(through.obj(function (row, enc, next) {
        if (!info.head.exists) info.head.exists = row.key[3];
        info.counts.exists ++;
        next();
    }, done));
    ustream.pipe(through.obj(function (row, enc, next) {
        if (!info.head.unseen) info.head.unseen = row.key[3];
        info.counts.unseen ++;
        next();
    }, done));
    rstream.pipe(through.obj(function (row, enc, next) {
        if (!info.head.recent) info.head.recent = row.key[3];
        info.counts.recent ++;
        next();
    }, done));
};

Mail.prototype.search = function (box, query, cb) {
    var self = this;
    var stream = self.db.createReadStream({
        gt: [ 'exists', box, null ],
        lt: [ 'exists', box, undefined ]
    });
    var seq = 0, pending = 1;
    
    var results = stream.pipe(through.obj(function (row, enc, next) {
        var rseq = ++ seq;
        pending ++;
        self._match(query, row, function (err, matching) {
            if (matching) {
                var hash = row.key[3];
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
